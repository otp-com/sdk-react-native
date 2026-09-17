import Foundation
import Otp

/// The Swift half of the bridge: everything that touches the SDK.
///
/// Split from `Otp.mm` because the two halves cannot be one file. React Native's codegen emits the
/// module protocol as Objective-C++, which Swift cannot import, while this SDK's surface is Swift
/// that Objective-C cannot see: async functions, typed throws, enums with associated values. So the
/// generated protocol is implemented in Objective-C++ and forwards to this, which is the only place
/// the SDK is spoken to.
///
/// Nothing here holds JavaScript state. The bridge is stateless by design, so a session is looked up
/// by the verification's id and rebuilt from the API when JavaScript has been reloaded out from under
/// it.
@objc(OtpBridge)
public final class OtpBridge: NSObject {

  /// One per process, because the sessions it holds have to outlive any single call.
  @objc public static let shared = OtpBridge()

  private let sessions = Sessions()

  @objc(configurePublishableKey:baseUrl:resolve:reject:)
  public func configure(
    publishableKey: String,
    baseUrl: String?,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    OtpClient.configure(publishableKey: publishableKey, baseURL: baseUrl.flatMap(URL.init(string:)))
    resolve(nil)
  }

  // MARK: - The presented screens

  @objc(verifyRecipient:locale:resolve:reject:)
  public func verify(
    recipient: String,
    locale: String?,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    Task { @MainActor in
      await answer(resolve, reject) {
        Self.dictionary(try await OtpClient.verify(recipient: recipient, locale: locale))
      }
    }
  }

  @objc(verifyCollectingKind:locale:resolve:reject:)
  public func verifyCollecting(
    kind: String,
    locale: String?,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    Task { @MainActor in
      await answer(resolve, reject) {
        guard let collecting = Self.recipientKind(kind) else {
          throw Refusal("collecting must be \"phone\" or \"email\", not \"\(kind)\"")
        }
        return Self.dictionary(try await OtpClient.verify(collecting: collecting, locale: locale))
      }
    }
  }

  @objc(resumeInterruptedWithResolve:reject:)
  public func resumeInterrupted(
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    Task { @MainActor in
      await answer(resolve, reject) {
        try await OtpClient.resumeInterrupted().map(Self.dictionary)
      }
    }
  }

  // MARK: - The core, for an app drawing its own screens

  @objc(startRecipient:locale:resolve:reject:)
  public func start(
    recipient: String,
    locale: String?,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    Task {
      await answer(resolve, reject) {
        let session = OtpSession()
        let pending = try await session.start(recipient: recipient, locale: locale)
        await sessions.remember(session, for: pending.id)
        return Self.dictionary(pending)
      }
    }
  }

  @objc(submitOtpId:code:resolve:reject:)
  public func submit(
    otpId: String,
    code: String,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    Task {
      await answer(resolve, reject) {
        let id = try Self.uuid(otpId)
        let session = try await sessions.session(for: id)
        let outcome = try await session.submit(code: code)
        if case .verified = outcome {
          await sessions.forget(id)
        }
        return Self.dictionary(outcome)
      }
    }
  }

  @objc(resendOtpId:channel:resolve:reject:)
  public func resend(
    otpId: String,
    channel: String?,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    Task {
      await answer(resolve, reject) {
        let id = try Self.uuid(otpId)
        let session = try await sessions.session(for: id)
        let requested = try channel.map { name -> OtpChannel in
          guard let known = Self.channel(name) else {
            throw Refusal("\(name) is not a channel this build can name")
          }
          return known
        }
        return Self.dictionary(try await session.resend(preferring: requested))
      }
    }
  }

  @objc(resumeOtpId:resolve:reject:)
  public func resume(
    otpId: String,
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    Task {
      await answer(resolve, reject) {
        let id = try Self.uuid(otpId)
        let session = OtpSession()
        let pending = try await session.resume(id, locale: OtpClient.interrupted?.locale)
        await sessions.remember(session, for: id)
        return Self.dictionary(pending)
      }
    }
  }

  @objc(interruptedWithResolve:reject:)
  public func interrupted(
    resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    guard let interrupted = OtpClient.interrupted else {
      resolve(nil)
      return
    }
    resolve([
      "otpId": interrupted.otpId.uuidString.lowercased(),
      "expiresAt": Self.iso(interrupted.expiresAt),
      "locale": interrupted.locale as Any? ?? NSNull(),
    ] as [String: Any])
  }

  // MARK: - Answering a promise

  /// Runs the body and reports it to the one promise, whichever way it went.
  ///
  /// Every method above goes through here, so a failure cannot reach JavaScript as anything but the
  /// documented rejection, and a promise cannot be left unanswered.
  private func answer(
    _ resolve: @escaping (Any?) -> Void,
    _ reject: @escaping (String?, String?, Error?) -> Void,
    _ body: () async throws -> Any?
  ) async {
    do {
      resolve(try await body())
    } catch let refusal as Refusal {
      reject("validationFailed", refusal.message, nil)
    } catch let error as OtpError {
      reject(Self.code(error.kind), error.message ?? Self.code(error.kind), Self.nsError(error))
    } catch {
      reject("unexpected", error.localizedDescription, error)
    }
  }

  // MARK: - Crossing the bridge

  /// The kinds, spelled exactly as `OtpErrorKind` in `index.ts`. The two lists are one contract, and
  /// a value that does not appear on both sides reaches application code as `unknown`.
  private static func code(_ kind: OtpError.Kind) -> String {
    switch kind {
    case .notConfigured: "notConfigured"
    case .unauthorized: "unauthorized"
    case .deviceProofRejected: "deviceProofRejected"
    case .deviceProofUnsupported: "deviceProofUnsupported"
    case .notFound: "notFound"
    case .conflict: "conflict"
    case .validationFailed: "validationFailed"
    case .rateLimited: "rateLimited"
    case .unavailable: "unavailable"
    case .transport: "transport"
    case .cancelled: "cancelled"
    case .noPresenter: "noPresenter"
    case .unexpected: "unexpected"
    @unknown default: "unknown"
    }
  }

  /// Carries the fields a promise rejection has nowhere else to put. React Native copies `userInfo`
  /// into the error it rejects with, which is where `index.ts` reads them back from.
  private static func nsError(_ error: OtpError) -> NSError {
    var info: [String: Any] = [:]
    if let type = error.type { info["type"] = type }
    if let statusCode = error.statusCode { info["statusCode"] = statusCode }
    if let retryAfter = error.retryAfter { info["retryAfterSeconds"] = retryAfter }
    return NSError(domain: "com.otp.sdk", code: 0, userInfo: info)
  }

  private static func dictionary(_ pending: PendingOtp) -> [String: Any] {
    [
      "id": pending.id.uuidString.lowercased(),
      "status": string(pending.status),
      "channel": pending.channel.map(string) as Any? ?? NSNull(),
      "maskedRecipient": pending.maskedRecipient,
      "codeLength": pending.codeLength,
      "expiresAt": iso(pending.expiresAt),
      "resendAvailableAt": pending.resendAvailableAt.map(iso) as Any? ?? NSNull(),
      "handoffUrl": pending.handoffURL?.absoluteString as Any? ?? NSNull(),
    ]
  }

  private static func dictionary(_ verification: Verification) -> [String: Any] {
    [
      "otpId": verification.otpId.uuidString.lowercased(),
      "token": verification.token,
      "tokenExpiresAt": iso(verification.tokenExpiresAt),
    ]
  }

  private static func dictionary(_ outcome: CodeSubmission) -> [String: Any] {
    switch outcome {
    case .verified(let verification):
      ["verification": dictionary(verification), "attemptsRemaining": NSNull(), "reason": NSNull()]
    case .rejected(let attemptsRemaining, let reason):
      ["verification": NSNull(), "attemptsRemaining": attemptsRemaining as Any? ?? NSNull(), "reason": string(reason)]
    @unknown default:
      ["verification": NSNull(), "attemptsRemaining": NSNull(), "reason": "unknown"]
    }
  }

  private static func string(_ reason: RejectionReason) -> String {
    switch reason {
    case .incorrectCode: "incorrectCode"
    case .expired: "expired"
    case .noAttemptsLeft: "noAttemptsLeft"
    case .unknown: "unknown"
    }
  }

  private static func string(_ status: OtpStatus) -> String {
    switch status {
    case .pending: "pending"
    case .approved: "approved"
    case .failed: "failed"
    case .expired: "expired"
    case .unknown: "unknown"
    @unknown default: "unknown"
    }
  }

  private static func string(_ channel: OtpChannel) -> String {
    switch channel {
    case .sms: "sms"
    case .whatsapp: "whatsapp"
    case .email: "email"
    case .telegram: "telegram"
    case .unknown: "unknown"
    @unknown default: "unknown"
    }
  }

  private static func channel(_ name: String) -> OtpChannel? {
    switch name {
    case "sms": .sms
    case "whatsapp": .whatsapp
    case "email": .email
    case "telegram": .telegram
    // Deliberately not `unknown`: a resend has to name a channel the API can act on, and this build
    // cannot name one it does not know.
    default: nil
    }
  }

  private static func recipientKind(_ name: String) -> RecipientKind? {
    switch name {
    case "phone": .phone
    case "email": .email
    default: nil
    }
  }

  /// ISO 8601 with the offset, which is what `new Date(…)` in JavaScript parses.
  private static func iso(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
  }

  private static func uuid(_ value: String) throws -> UUID {
    guard let id = UUID(uuidString: value) else {
      throw Refusal("\(value) is not a verification id")
    }
    return id
  }
}

/// An argument this bridge refused before the SDK ever saw it.
///
/// Its own type because `OtpError` cannot be built from outside the SDK, which is deliberate: an
/// error carrying the SDK's name should come from the SDK. It crosses as `validationFailed`, the same
/// kind the API returns for a value it will not accept.
private struct Refusal: Error {
  let message: String

  init(_ message: String) {
    self.message = message
  }
}

/// The sessions of verifications that are in flight.
///
/// JavaScript passes an id on every call and holds no session, so this is where the native half of
/// that mapping lives. An id with no session here is one whose process outlived its JavaScript, and
/// it is rebuilt from the API rather than refused.
private actor Sessions {
  private var sessions: [UUID: OtpSession] = [:]

  func session(for id: UUID) async throws -> OtpSession {
    if let existing = sessions[id] { return existing }
    let rebuilt = OtpSession()
    _ = try await rebuilt.resume(id, locale: OtpClient.interrupted?.locale)
    sessions[id] = rebuilt
    return rebuilt
  }

  func remember(_ session: OtpSession, for id: UUID) {
    sessions[id] = session
  }

  func forget(_ id: UUID) {
    sessions.removeValue(forKey: id)
  }
}
