package com.otp.sdk.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.WritableNativeMap
import com.otp.sdk.CodeSubmission
import com.otp.sdk.OtpChannel
import com.otp.sdk.OtpClient
import com.otp.sdk.OtpException
import com.otp.sdk.OtpSession
import com.otp.sdk.OtpStatus
import com.otp.sdk.PendingOtp
import com.otp.sdk.Verification
import com.otp.sdk.resumeInterrupted
import com.otp.sdk.ui.RecipientKind
import com.otp.sdk.verify
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

// `NativeOtpSpec` needs no import: codegen emits it into this package, which `codegenConfig` in
// package.json names.

/**
 * The Android half of the bridge.
 *
 * Nothing here decides anything about a verification: it converts arguments, calls the SDK, and
 * converts the answer. The counterpart on iOS is `OtpBridge.swift`, and the two are deliberately the
 * same shape, because the contract they serve is one file of TypeScript.
 *
 * Stateless as far as JavaScript is concerned. The SDK holds a session, this maps it to the
 * verification's id, and an id with no session is one whose process outlived its JavaScript: it is
 * rebuilt from the API rather than refused.
 */
class OtpModule(private val context: ReactApplicationContext) : NativeOtpSpec(context) {

    /** The module's own scope, so a call outlives the JavaScript that made it. */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val sessions = ConcurrentHashMap<UUID, OtpSession>()

    override fun getName(): String = NAME

    override fun configure(publishableKey: String, baseUrl: String?, promise: Promise) {
        answer(promise) {
            OtpClient.configure(context, publishableKey, baseUrl)
            null
        }
    }

    // The presented screens. They are the reason this package exists: an app that builds its own on
    // the calls below has to rewrite six languages, right-to-left layout, the one-time-code autofill
    // and the WhatsApp handoff, all of which are already here.

    override fun verify(recipient: String, locale: String?, promise: Promise) {
        answer(promise) { map(OtpClient.verify(recipient, locale)) }
    }

    override fun verifyCollecting(kind: String, locale: String?, promise: Promise) {
        answer(promise) {
            val collecting = recipientKind(kind)
                ?: throw Refusal("collecting must be \"phone\" or \"email\", not \"$kind\"")
            map(OtpClient.verify(collecting = collecting, locale = locale))
        }
    }

    override fun resumeInterrupted(promise: Promise) {
        answer(promise) { OtpClient.resumeInterrupted()?.let(::map) }
    }

    // The core, for an app drawing its own screens.

    override fun start(recipient: String, locale: String?, promise: Promise) {
        answer(promise) {
            val session = OtpSession()
            val pending = session.start(recipient, locale)
            sessions[pending.id] = session
            map(pending)
        }
    }

    override fun submit(otpId: String, code: String, promise: Promise) {
        answer(promise) {
            val id = uuid(otpId)
            val outcome = session(id).submit(code)
            if (outcome is CodeSubmission.Verified) sessions.remove(id)
            map(outcome)
        }
    }

    override fun resend(otpId: String, channel: String?, promise: Promise) {
        answer(promise) {
            val id = uuid(otpId)
            val requested = channel?.let {
                channel(it) ?: throw Refusal("$it is not a channel this build can name")
            }
            map(session(id).resend(requested))
        }
    }

    override fun resume(otpId: String, promise: Promise) {
        answer(promise) {
            val id = uuid(otpId)
            val session = OtpSession()
            val pending = session.resume(id, OtpClient.interrupted?.locale)
            sessions[id] = session
            map(pending)
        }
    }

    override fun interrupted(promise: Promise) {
        answer(promise) {
            OtpClient.interrupted?.let {
                WritableNativeMap().apply {
                    putString("otpId", it.otpId.toString())
                    putString("expiresAt", iso(it.expiresAt))
                    putStringOrNull("locale", it.locale)
                }
            }
        }
    }

    /**
     * Runs the body and reports it to the one promise, whichever way it went.
     *
     * Every method above goes through here, so a failure cannot reach JavaScript as anything but the
     * documented rejection, and a promise cannot be left unanswered.
     */
    private fun answer(promise: Promise, body: suspend () -> Any?) {
        scope.launch {
            try {
                promise.resolve(body())
            } catch (refusal: Refusal) {
                promise.reject("validationFailed", refusal.message, null)
            } catch (error: OtpException) {
                promise.reject(code(error.kind), error.message ?: code(error.kind), error, details(error))
            }
        }
    }

    /**
     * The session for a verification, rebuilt when there is none.
     *
     * JavaScript survives its own reloads and the native side survives longer still, so an id can
     * arrive here for a verification this process has no session for. Reading it back from the API is
     * what the id is for.
     */
    private suspend fun session(id: UUID): OtpSession =
        sessions[id] ?: OtpSession().also {
            it.resume(id, OtpClient.interrupted?.locale)
            sessions[id] = it
        }

    /** An argument this bridge refused before the SDK ever saw it. */
    private class Refusal(override val message: String) : Exception(message)

    private companion object {
        /**
         * The kinds, spelled exactly as `OtpErrorKind` in `index.ts`. The two lists are one contract,
         * and a value that does not appear on both sides reaches application code as `unknown`.
         */
        fun code(kind: OtpException.Kind): String = when (kind) {
            OtpException.Kind.NOT_CONFIGURED -> "notConfigured"
            OtpException.Kind.UNAUTHORIZED -> "unauthorized"
            OtpException.Kind.DEVICE_PROOF_REJECTED -> "deviceProofRejected"
            OtpException.Kind.DEVICE_PROOF_UNSUPPORTED -> "deviceProofUnsupported"
            OtpException.Kind.NOT_FOUND -> "notFound"
            OtpException.Kind.CONFLICT -> "conflict"
            OtpException.Kind.VALIDATION_FAILED -> "validationFailed"
            OtpException.Kind.RATE_LIMITED -> "rateLimited"
            OtpException.Kind.UNAVAILABLE -> "unavailable"
            OtpException.Kind.TRANSPORT -> "transport"
            OtpException.Kind.CANCELLED -> "cancelled"
            OtpException.Kind.NO_PRESENTER -> "noPresenter"
            OtpException.Kind.UNEXPECTED -> "unexpected"
        }

        /**
         * Carries the fields a rejection has nowhere else to put. React Native copies this map into
         * the error's `userInfo`, which is where `index.ts` reads them back from.
         */
        fun details(error: OtpException): WritableMap = WritableNativeMap().apply {
            error.type?.let { putString("type", it) }
            error.statusCode?.let { putInt("statusCode", it) }
            error.retryAfterSeconds?.let { putDouble("retryAfterSeconds", it.toDouble()) }
        }

        fun map(pending: PendingOtp): WritableMap = WritableNativeMap().apply {
            putString("id", pending.id.toString())
            putString("status", string(pending.status))
            putStringOrNull("channel", pending.channel?.let(::string))
            putString("maskedRecipient", pending.maskedRecipient)
            putInt("codeLength", pending.codeLength)
            putString("expiresAt", iso(pending.expiresAt))
            putStringOrNull("resendAvailableAt", pending.resendAvailableAt?.let(::iso))
            putStringOrNull("handoffUrl", pending.handoffUrl)
        }

        fun map(verification: Verification): WritableMap = WritableNativeMap().apply {
            putString("otpId", verification.otpId.toString())
            putString("token", verification.token)
            putString("tokenExpiresAt", iso(verification.tokenExpiresAt))
        }

        fun map(outcome: CodeSubmission): WritableMap = WritableNativeMap().apply {
            when (outcome) {
                is CodeSubmission.Verified -> {
                    putMap("verification", map(outcome.verification))
                    putNull("attemptsRemaining")
                }

                is CodeSubmission.Rejected -> {
                    putNull("verification")
                    outcome.attemptsRemaining?.let { putInt("attemptsRemaining", it) }
                        ?: putNull("attemptsRemaining")
                }
            }
        }

        fun string(status: OtpStatus): String = when (status) {
            OtpStatus.PENDING -> "pending"
            OtpStatus.APPROVED -> "approved"
            OtpStatus.FAILED -> "failed"
            OtpStatus.EXPIRED -> "expired"
            OtpStatus.UNKNOWN -> "unknown"
        }

        fun string(channel: OtpChannel): String = when (channel) {
            OtpChannel.SMS -> "sms"
            OtpChannel.WHATSAPP -> "whatsapp"
            OtpChannel.EMAIL -> "email"
            OtpChannel.TELEGRAM -> "telegram"
            OtpChannel.UNKNOWN -> "unknown"
        }

        // Deliberately no `unknown`: a resend has to name a channel the API can act on, and this
        // build cannot name one it does not know.
        fun channel(name: String): OtpChannel? = when (name) {
            "sms" -> OtpChannel.SMS
            "whatsapp" -> OtpChannel.WHATSAPP
            "email" -> OtpChannel.EMAIL
            "telegram" -> OtpChannel.TELEGRAM
            else -> null
        }

        fun recipientKind(name: String): RecipientKind? = when (name) {
            "phone" -> RecipientKind.PHONE
            "email" -> RecipientKind.EMAIL
            else -> null
        }

        /** ISO 8601 with the offset, which is what `new Date(…)` in JavaScript parses. */
        fun iso(instant: Instant): String = DateTimeFormatter.ISO_INSTANT.format(instant)

        fun uuid(value: String): UUID = runCatching { UUID.fromString(value) }.getOrNull()
            ?: throw Refusal("$value is not a verification id")

        fun WritableMap.putStringOrNull(key: String, value: String?) {
            if (value == null) putNull(key) else putString(key, value)
        }
    }
}
