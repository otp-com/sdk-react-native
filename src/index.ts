import NativeOtp from './NativeOtp';
import type {
  NativeCodeSubmission,
  NativeInterrupted,
  NativePendingOtp,
  NativeVerification,
} from './NativeOtp';

/** Channel a verification was dispatched on. */
export type OtpChannel = 'sms' | 'whatsapp' | 'email' | 'telegram' | 'unknown';

/** Where a verification stands. */
export type OtpStatus = 'pending' | 'approved' | 'failed' | 'expired' | 'unknown';

/**
 * A verification that has been started and not yet answered. Both deadlines are here, so countdowns
 * run on the device: there is nothing to poll.
 */
export interface PendingOtp {
  id: string;
  status: OtpStatus;
  /** Null until routing has picked a channel. */
  channel: OtpChannel | null;
  /** The recipient with its middle digits masked. The full recipient never reaches the device. */
  maskedRecipient: string;
  /** How many characters the code has, so the input can draw the right number of boxes. */
  codeLength: number;
  expiresAt: Date;
  /** Null when this verification can no longer be resent at all. */
  resendAvailableAt: Date | null;
  /** WhatsApp only: the link the user opens to be sent the code. */
  handoffUrl: string | null;
}

/**
 * Proof that a verification succeeded. Send `token` to your own backend, which exchanges it with your
 * server key to learn which recipient was verified. A result read off a device you do not control
 * proves nothing by itself, so the token is the whole security model.
 */
export interface Verification {
  otpId: string;
  token: string;
  tokenExpiresAt: Date;
}

/** Why a submitted code was rejected. */
export type RejectionReason = 'incorrectCode' | 'expired' | 'noAttemptsLeft' | 'unknown';

/** What submitting a code produced. A wrong code is an outcome, not an error. */
export type CodeSubmission =
  | { matched: true; verification: Verification }
  | { matched: false; attemptsRemaining: number | null; reason: RejectionReason };

/**
 * A verification this install started and has not answered, found again after a restart.
 *
 * Only the id and the deadlines, because that is all the device kept. Pass `otpId` to `resume` to
 * read the verification itself back from the API.
 */
export interface InterruptedVerification {
  otpId: string;
  expiresAt: Date;
  /** The language the code was sent in. A resumed screen in another one contradicts the message. */
  locale: string | null;
}

/** Which recipient the SDK should collect, when it collects one. */
export type RecipientKind = 'phone' | 'email';

/**
 * What went wrong, in a form code can branch on.
 *
 * `notConfigured`, `unauthorized` and `unexpected` are wiring problems: show one honest sentence and
 * put the message in your logs. `rateLimited`, `validationFailed`, `conflict` and `unavailable` are
 * things the user can act on. `cancelled` means they closed the screen, which is not a failure of
 * anything.
 *
 * A kind this build was never told about arrives as `unknown`, for the same reason a channel does.
 */
export type OtpErrorKind =
  | 'notConfigured'
  | 'unauthorized'
  | 'deviceProofRejected'
  | 'deviceProofUnsupported'
  | 'notFound'
  | 'conflict'
  | 'validationFailed'
  | 'rateLimited'
  | 'unavailable'
  | 'transport'
  | 'cancelled'
  | 'noPresenter'
  | 'unexpected'
  | 'unknown';

/** Every call in this module rejects with this and with nothing else. */
export class OtpError extends Error {
  readonly kind: OtpErrorKind;
  /**
   * The API's own error type, such as `otp_resend_exhausted`. Present only when the API answered.
   * It is what tells two failures of the same kind apart: a `conflict` is either a recipient no
   * channel can reach or a verification that can never be resent again.
   */
  readonly type: string | null;
  readonly statusCode: number | null;
  /** How long to wait, when the API said. Only ever set on `rateLimited`. */
  readonly retryAfterSeconds: number | null;

  constructor(
    kind: OtpErrorKind,
    message: string,
    details: { type?: string | null; statusCode?: number | null; retryAfterSeconds?: number | null } = {},
  ) {
    super(message);
    this.name = 'OtpError';
    this.kind = kind;
    this.type = details.type ?? null;
    this.statusCode = details.statusCode ?? null;
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
  }
}

const KNOWN_CHANNELS: readonly OtpChannel[] = ['sms', 'whatsapp', 'email', 'telegram'];
const KNOWN_STATUSES: readonly OtpStatus[] = ['pending', 'approved', 'failed', 'expired'];
const KNOWN_ERROR_KINDS: readonly OtpErrorKind[] = [
  'notConfigured',
  'unauthorized',
  'deviceProofRejected',
  'deviceProofUnsupported',
  'notFound',
  'conflict',
  'validationFailed',
  'rateLimited',
  'unavailable',
  'transport',
  'cancelled',
  'noPresenter',
  'unexpected',
];

// An unrecognised value becomes `unknown` rather than being passed through. Routing gains channels
// over time and an app already on a phone cannot be updated to match, so a value this build was never
// told about must not reach application code as something it has to guess about.
const toChannel = (value: string | null): OtpChannel | null => {
  if (value === null) return null;
  return KNOWN_CHANNELS.includes(value as OtpChannel) ? (value as OtpChannel) : 'unknown';
};

const toStatus = (value: string): OtpStatus =>
  KNOWN_STATUSES.includes(value as OtpStatus) ? (value as OtpStatus) : 'unknown';

/**
 * Turns whatever the bridge rejected with into an `OtpError`.
 *
 * A rejection from a native module arrives as an `Error` with `code` and `userInfo`, and a rejection
 * from anywhere else arrives as something this module never promised. Both leave here as the one
 * type the published API documents.
 */
const toOtpError = (raw: unknown): OtpError => {
  const source = raw as { code?: unknown; message?: unknown; userInfo?: Record<string, unknown> } | null;
  const code = typeof source?.code === 'string' ? source.code : '';
  const kind = KNOWN_ERROR_KINDS.includes(code as OtpErrorKind) ? (code as OtpErrorKind) : 'unknown';
  const message = typeof source?.message === 'string' && source.message !== '' ? source.message : kind;
  const info = source?.userInfo ?? {};
  const number = (value: unknown): number | null => (typeof value === 'number' ? value : null);
  return new OtpError(kind, message, {
    type: typeof info.type === 'string' ? info.type : null,
    statusCode: number(info.statusCode),
    retryAfterSeconds: number(info.retryAfterSeconds),
  });
};

/** Every call goes through here, so nothing but an `OtpError` can leave this module. */
const rejecting = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (raw) {
    throw toOtpError(raw);
  }
};

const toPendingOtp = (native: NativePendingOtp): PendingOtp => ({
  id: native.id,
  status: toStatus(native.status),
  channel: toChannel(native.channel),
  maskedRecipient: native.maskedRecipient,
  codeLength: native.codeLength,
  expiresAt: new Date(native.expiresAt),
  resendAvailableAt: native.resendAvailableAt === null ? null : new Date(native.resendAvailableAt),
  handoffUrl: native.handoffUrl,
});

const toVerification = (native: NativeVerification): Verification => ({
  otpId: native.otpId,
  token: native.token,
  tokenExpiresAt: new Date(native.tokenExpiresAt),
});

const KNOWN_REJECTION_REASONS: RejectionReason[] = ['incorrectCode', 'expired', 'noAttemptsLeft', 'unknown'];

const toRejectionReason = (reason: string | null): RejectionReason =>
  KNOWN_REJECTION_REASONS.includes(reason as RejectionReason) ? (reason as RejectionReason) : 'unknown';

const toCodeSubmission = (native: NativeCodeSubmission): CodeSubmission => {
  if (native.verification === null) {
    return { matched: false, attemptsRemaining: native.attemptsRemaining, reason: toRejectionReason(native.reason) };
  }
  return { matched: true, verification: toVerification(native.verification) };
};

/**
 * Points the SDK at one app. Call once, before starting a verification.
 *
 * The publishable key is designed to sit inside an app binary: it is scoped to a single app and can
 * only start and answer verifications. It can never read a recipient or exchange a verification.
 */
export function configure(options: { publishableKey: string; baseUrl?: string }): Promise<void> {
  return rejecting(() => NativeOtp.configure(options.publishableKey, options.baseUrl ?? null));
}

/**
 * Runs a verification end to end, presenting the platform's own code screen.
 *
 * This is the short way to use the SDK. The screen follows the system light and dark appearance, is
 * translated into six languages, lays itself out right to left where the language reads that way,
 * accepts the one-time code the OS offers from the message, and handles the WhatsApp round trip.
 *
 * Rejects with kind `cancelled` if the user closes the screen.
 *
 * @param recipient A phone number in E.164 form, or an email address. The SDK does not collect it:
 * your own screen already has it, and asking twice is worse than asking once.
 * @param locale BCP-47 locale for the message and for the screen. Defaults to the device's.
 */
export async function verify(recipient: string, locale?: string): Promise<Verification> {
  return toVerification(await rejecting(() => NativeOtp.verify(recipient, locale ?? null)));
}

/**
 * Runs a verification end to end, collecting the recipient first.
 *
 * Use this when your own flow has no phone or email field yet. If it does, pass the value to
 * `verify` instead.
 *
 * One kind per call, not a choice offered to the user: an app collects phone numbers or it collects
 * email addresses.
 */
export async function verifyCollecting(kind: RecipientKind, locale?: string): Promise<Verification> {
  return toVerification(await rejecting(() => NativeOtp.verifyCollecting(kind, locale ?? null)));
}

/**
 * Picks up a verification that was left in flight, presenting its code screen.
 *
 * Call it when your app becomes active. The WhatsApp handoff sends the user to another app to be
 * given their code, and the OS may kill yours while they are away; without this they come back to a
 * code they can no longer use anywhere.
 *
 * Resolves with null when there was nothing to resume, which includes a verification that has
 * expired or been answered in the meantime, and when the user closes the screen.
 */
export async function resumeInterrupted(): Promise<Verification | null> {
  const native = await rejecting(() => NativeOtp.resumeInterrupted());
  // Loose on purpose. A native module that resolves with nothing arrives here as `undefined` rather
  // than as the `null` the generated types promise, and a strict comparison then reads a field off
  // it. The codegen types cannot express that, so every nullable answer is checked this way.
  return native == null ? null : toVerification(native);
}

/**
 * Starts a verification and has the code delivered, for an app drawing its own screens.
 *
 * Everything the screen needs is on the answer, including both deadlines, so countdowns run on the
 * device and there is nothing to poll.
 */
export async function start(recipient: string, locale?: string): Promise<PendingOtp> {
  return toPendingOtp(await rejecting(() => NativeOtp.start(recipient, locale ?? null)));
}

/** Submits the code the user entered. */
export async function submit(otpId: string, code: string): Promise<CodeSubmission> {
  return toCodeSubmission(await rejecting(() => NativeOtp.submit(otpId, code)));
}

/**
 * Sends the code again, moving to the next channel in the app's routing order.
 *
 * @param channel Names a channel instead of advancing, for when the user says the current one cannot
 * reach them. It has to be enabled for the app.
 */
export async function resend(otpId: string, channel?: Exclude<OtpChannel, 'unknown'>): Promise<PendingOtp> {
  return toPendingOtp(await rejecting(() => NativeOtp.resend(otpId, channel ?? null)));
}

/**
 * Picks a verification back up after the app was killed while the user was away receiving the code.
 * Its deadlines come back with it, so a screen can rebuild its countdowns.
 *
 * This is not a poll. Both deadlines are on ``PendingOtp`` and run on the device.
 */
export async function resume(otpId: string): Promise<PendingOtp> {
  return toPendingOtp(await rejecting(() => NativeOtp.resume(otpId)));
}

/**
 * The verification this install left in flight, or null.
 *
 * Read from the native SDK's own store, so it survives the process being killed while the user was
 * away receiving their code. It makes no request: pass `otpId` to `resume` to read the verification
 * back and draw your own screen for it, or call `resumeInterrupted` to let the SDK present its own.
 */
export async function interrupted(): Promise<InterruptedVerification | null> {
  const native: NativeInterrupted | null = await rejecting(() => NativeOtp.interrupted());
  // See `resumeInterrupted`: nothing crosses the bridge as `undefined`, not as `null`.
  if (native == null) return null;
  return { otpId: native.otpId, expiresAt: new Date(native.expiresAt), locale: native.locale };
}
