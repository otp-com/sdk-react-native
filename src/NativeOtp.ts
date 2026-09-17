import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

// The contract between JavaScript and the two native SDKs. React Native's codegen reads this file to
// generate the native interfaces, so it is limited to what the bridge can carry: strings, numbers,
// booleans, and objects of those. Three consequences show up in every shape below.
//
// Dates cross as ISO 8601 strings, because the bridge has no date type. The wrapper in `index.ts`
// turns them back into `Date`, so the published API is not the bridge's API.
//
// Failures cross as promise rejections carrying a machine-readable code, because the bridge has no
// error type either. `index.ts` turns them back into an `OtpError`.
//
// Nothing here is stateful. The native SDKs hold a session object; this surface deliberately does
// not, and passes the verification's id on every call instead. A JavaScript reload throws away the
// JavaScript half of the world while the native half survives, so any state kept on one side only
// would come back out of step with the other.

export interface NativePendingOtp {
  id: string;
  /** `pending`, `approved`, `failed`, `expired`, or `unknown` for a status this build cannot name. */
  status: string;
  /** Null until routing has picked a channel. */
  channel: string | null;
  maskedRecipient: string;
  codeLength: number;
  expiresAt: string;
  resendAvailableAt: string | null;
  /** WhatsApp only: the link the user opens to be sent the code. */
  handoffUrl: string | null;
}

export interface NativeVerification {
  otpId: string;
  token: string;
  tokenExpiresAt: string;
}

export interface NativeInterrupted {
  otpId: string;
  expiresAt: string;
  locale: string | null;
}

export interface NativeCodeSubmission {
  /** Present when the code matched. The token is the only part your backend may trust. */
  verification: NativeVerification | null;
  /** Set when the code did not match, and null once the verification is resolved. */
  attemptsRemaining: number | null;
}

export interface Spec extends TurboModule {
  configure(publishableKey: string, baseUrl: string | null): Promise<void>;

  // The drop-in screens, presented by the platform. They are the reason this package exists: an app
  // that builds its own screen on the calls below has to rewrite six languages, right-to-left
  // layout, one-time-code autofill and the WhatsApp handoff, all of which are already here.
  //
  // Each resolves with the proof, or rejects with `cancelled` when the user closes the screen.

  /** Presents the code screen for a recipient your own screen already collected. */
  verify(recipient: string, locale: string | null): Promise<NativeVerification>;

  /** Presents the recipient screen, then the code screen. `kind` is `phone` or `email`. */
  verifyCollecting(kind: string, locale: string | null): Promise<NativeVerification>;

  /**
   * Presents the code screen for a verification left in flight, if there is one.
   *
   * Resolves with null when there was nothing to resume, which includes a verification that has
   * expired or been answered in the meantime, and when the user closes the screen.
   */
  resumeInterrupted(): Promise<NativeVerification | null>;

  // The core, for an app that wants its own screens. Everything above is built on exactly this.

  start(recipient: string, locale: string | null): Promise<NativePendingOtp>;
  submit(otpId: string, code: string): Promise<NativeCodeSubmission>;
  resend(otpId: string, channel: string | null): Promise<NativePendingOtp>;
  resume(otpId: string): Promise<NativePendingOtp>;

  /**
   * The verification this install left in flight, or null. Reads what the device kept and makes no
   * request, so it is safe to call on launch.
   *
   * Read from the native SDK's own store rather than from JavaScript, so it survives the process
   * being killed while the user was away in WhatsApp receiving their code. Without it an app would
   * have to persist the id itself to be able to call `resume`.
   */
  interrupted(): Promise<NativeInterrupted | null>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Otp');
