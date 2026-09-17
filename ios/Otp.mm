#import <OtpSpec/OtpSpec.h>

#if __has_include("OtpReactNative-Swift.h")
#import "OtpReactNative-Swift.h"
#else
#import <OtpReactNative/OtpReactNative-Swift.h>
#endif

// The generated module protocol, and the reason this file exists at all.
//
// React Native's codegen emits `NativeOtpSpec` as Objective-C++, which Swift cannot import, while the
// SDK underneath is Swift that Objective-C cannot see. So the protocol is implemented here and every
// method forwards to `OtpBridge`, which is where the SDK is actually spoken to. Nothing in this file
// decides anything: if a line here does more than forward, it is in the wrong file.

// Declared here rather than in a header of its own. A public header would join this pod's module map
// and clang would then build it as Objective-C, which the generated spec cannot be: it is
// Objective-C++, and the module fails to build with a C++ standard header reported missing.
//
// The class name is the contract. JavaScript reaches this through
// `TurboModuleRegistry.getEnforcing<Spec>('Otp')`, and `RCT_EXPORT_MODULE()` derives the registered
// name from the class.
@interface Otp : NSObject <NativeOtpSpec>
@end

@implementation Otp

RCT_EXPORT_MODULE()

- (void)configure:(NSString *)publishableKey
          baseUrl:(NSString *)baseUrl
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  [OtpBridge.shared configurePublishableKey:publishableKey baseUrl:baseUrl resolve:resolve reject:reject];
}

- (void)verify:(NSString *)recipient
        locale:(NSString *)locale
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  [OtpBridge.shared verifyRecipient:recipient locale:locale resolve:resolve reject:reject];
}

- (void)verifyCollecting:(NSString *)kind
                  locale:(NSString *)locale
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject
{
  [OtpBridge.shared verifyCollectingKind:kind locale:locale resolve:resolve reject:reject];
}

- (void)resumeInterrupted:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [OtpBridge.shared resumeInterruptedWithResolve:resolve reject:reject];
}

- (void)start:(NSString *)recipient
       locale:(NSString *)locale
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject
{
  [OtpBridge.shared startRecipient:recipient locale:locale resolve:resolve reject:reject];
}

- (void)submit:(NSString *)otpId
          code:(NSString *)code
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  [OtpBridge.shared submitOtpId:otpId code:code resolve:resolve reject:reject];
}

- (void)resend:(NSString *)otpId
       channel:(NSString *)channel
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  [OtpBridge.shared resendOtpId:otpId channel:channel resolve:resolve reject:reject];
}

- (void)resume:(NSString *)otpId
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  [OtpBridge.shared resumeOtpId:otpId resolve:resolve reject:reject];
}

- (void)interrupted:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [OtpBridge.shared interruptedWithResolve:resolve reject:reject];
}

// The screens are presented by UIKit, so the calls that present one have to arrive on the main
// thread. The rest are answered on the module's own queue, and none of them touch UIKit.
+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeOtpSpecJSI>(params);
}

@end
