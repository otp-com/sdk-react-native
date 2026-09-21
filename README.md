# otp.com React Native SDK

[![npm](https://img.shields.io/npm/v/@otp.com/sdk-react-native)](https://www.npmjs.com/package/@otp.com/sdk-react-native)


Verifies a phone number or an email address with a one-time code. The channel is chosen by your
account routing, so you pass the recipient and nothing else.

This package is a bridge over the native otp.com SDKs, not a re-implementation. The screen your user
sees is the platform's own: UIKit-backed SwiftUI on iOS, Compose on Android.

Requires the **New Architecture**, **iOS 15**, and **Android API 26**. Built and tested against
**React Native 0.87**; older versions are not tested rather than known to be unsupported.

Android 26, not React Native's own 24, and the reason is worth knowing before you upgrade a project:
the Android SDK's security floor is hardware-backed key attestation, which is only guaranteed from
8.0. A project that builds against plain React Native can therefore fail to build against this
package until you raise `minSdkVersion`.

## Before you start

You need two keys, and they are not interchangeable.

1. Sign in at [panel.otp.com](https://panel.otp.com?utm_source=github-sdk-react-native). If you do
   not have an account yet, [create one](https://panel.otp.com/signup?utm_source=github-sdk-react-native);
   it takes a minute and comes with sandbox credit.
2. Open your app, then **API Keys**, and create two:
   - a **publishable key** (`otp_pk_live_…`) for this SDK, which goes in your app;
   - a **server key** (`otp_live_…`) for your own backend, which never leaves it.
3. While you are integrating, use the `otp_pk_test_…` and `otp_test_…` pair instead. Sandbox sends no
   real messages and costs nothing.

The publishable key is meant to be readable: it ships inside your app, it is scoped to that one app,
and it can only start and answer verifications. It cannot read a recipient and it cannot exchange a
verification, which is why the server key exists and why it stays on your server.

## Install

```sh
npm install @otp.com/sdk-react-native
cd ios && pod install
```

Then raise the Android floor in `android/build.gradle`:

```gradle
buildscript {
    ext {
        minSdkVersion = 26
    }
}
```

Nothing else to register: autolinking finds the native module on both platforms.

## Use it

Configure once, at launch:

```ts
import {configure, verify} from '@otp.com/sdk-react-native';

await configure({publishableKey: 'otp_pk_live_…'});
```

Then run a verification. This presents a screen, sends the code, takes the user's input, and resolves
when it is done:

```ts
const verification = await verify('+14155552671');
```

If your flow has no phone field yet, let the SDK collect it:

```ts
const verification = await verifyCollecting('phone'); // or 'email'
```

The message and the screen follow the same locale, so they never disagree. It defaults to the
device's; pass one to override:

```ts
const verification = await verify('+14155552671', 'tr-TR');
```

The screen speaks English, Turkish, Russian, Arabic, German and French, lays itself out right to left
where the language reads that way, follows the system light and dark appearance, and takes its accent
colour from your panel. Its one and only decision that is yours is that colour.

## The one thing to get right

**`verification.token` is the result. Nothing else is.**

Send it to your own backend, which exchanges it with your **server** key:

```
POST https://api.otp.com/api/v1/verifications/exchange
Authorization: Bearer otp_live_…

{ "verification_token": "…" }
```

It answers with what was actually verified:

```json
{
  "otp_id": "6f0d2c5e-1c3a-4f1b-9a2e-6a1f2b3c4d5e",
  "recipient": "+14155552671",
  "recipient_type": "phone",
  "channel": "sms",
  "verified_at": "2026-09-08T19:33:21Z"
}
```

Until you make that call, your backend knows nothing. A success read off a device you do not control
is not evidence, and anyone running a modified build can claim any outcome they like. The token is
short-lived and single-purpose, so treat it as the only thing you trust.

Our [backend SDKs](https://github.com/otp-com?utm_source=github-sdk-react-native) do this call for
you in Node, PHP, Go and Python.

## Resuming

On the WhatsApp channel the code is not sent until the user messages us, which means they leave your
app and the OS may kill it while they are away. Call this when your app becomes active and they come
back to the screen they left:

```ts
const verification = await resumeInterrupted();
if (verification) {
  // finish the sign-in
}
```

It resolves with `null` when there was nothing in flight, which includes a verification that expired
while they were away and one they closed without answering.

## Your own screen

The drop-in screen has no view-slot API, because a screen assembled from someone else's slots is
worse than one you wrote. If you want a different screen, build it on the same calls the drop-in uses:

```ts
const pending = await start('+14155552671');

pending.codeLength         // how many boxes to draw, and it is not always 6
pending.expiresAt          // count down from this
pending.resendAvailableAt  // null means it can never be resent, not "resend now"
pending.handoffUrl         // WhatsApp only: open this, the code follows

const outcome = await submit(pending.id, entered);
if (outcome.matched) {
  // outcome.verification.token
} else {
  // a wrong code is an outcome, not an error
  outcome.attemptsRemaining;
}
```

Everything a screen needs is on the answer, including both deadlines, so no part of this polls.

`codeLength` is worth reading rather than assuming: it is your account's setting and it is not always
six.

After a restart you can pick a verification back up without having stored anything yourself:

```ts
const inFlight = await interrupted();     // makes no request
if (inFlight) {
  const pending = await resume(inFlight.otpId);
}
```

## Device integrity

The native SDK registers a hardware-backed key on first use, with App Attest on iOS and Keystore
attestation on Android, and signs every send with it. That is what stops a publishable key lifted out
of your bundle from being used outside your app.

You configure nothing for this. Two consequences worth knowing:

- **Neither an iOS simulator nor an Android emulator can produce a proof.** Where a proof is
  required, sends from them are refused with kind `deviceProofRejected`. Test that path on hardware.
- **Whether a proof is required follows the key.** A sandbox key (`otp_pk_test_…`) never requires
  one, so a simulator and an emulator are fine while you integrate. A live key does, once the
  platform asks for it, which is why the last thing to test before going live is a real device with
  your live key.

## Errors

Every call in this package rejects with an `OtpError` and with nothing else. Read `kind` to decide
what to do, and keep `message` for your logs: it is written for you, not for your user, and it is not
translated.

```ts
import {OtpError, verify} from '@otp.com/sdk-react-native';

try {
  const verification = await verify(recipient);
} catch (error) {
  if (!(error instanceof OtpError)) throw error;
  switch (error.kind) {
    case 'cancelled':
      break; // the user closed the screen
    case 'rateLimited':
      wait(error.retryAfterSeconds);
      break;
    case 'validationFailed':
      showYourOwnFieldError();
      break;
    default:
      log(error);
  }
}
```

`kind` can be a value your build has never heard of, and arrives as `'unknown'` when it is: the list
grows server-side and an app already on a phone cannot be updated to match. `error.type` carries the
API's own name for the failure, which is what tells two failures of the same kind apart.

## Example

[`example/`](./example) is a small app that calls every entry point: the presented screens, the core
calls for an app drawing its own, and reading back a verification left in flight.

```sh
cd example
npm install
(cd ios && pod install)
npm run ios      # or: npm run android
```

Put your own publishable key in the field at the top and tap **configure** before anything else.

## License

This package is [Apache-2.0](./LICENSE), and the native SDKs it bridges are not. Those ship as
compiled binaries under otp.com's commercial licence, which is why the boundary is worth stating:
what you may fork and redistribute freely is the glue, not the SDK underneath.

## Support

Docs and status: [otp.com](https://otp.com?utm_source=github-sdk-react-native). Anything else:
info@otp.com.

## Issues

This repository is where the package is documented and where issues are reported. The package itself
is published to npm as [`@otp.com/sdk-react-native`](https://www.npmjs.com/package/@otp.com/sdk-react-native).
