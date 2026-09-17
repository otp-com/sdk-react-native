package com.otp.sdk.reactnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * What autolinking finds. One module, registered under the name JavaScript asks for.
 *
 * A [BaseReactPackage] rather than a list of modules: the New Architecture looks a module up by name
 * and builds only that one, so nothing here is constructed for an app that never verifies anything.
 */
class OtpPackage : BaseReactPackage() {

    // `NativeOtpSpec.NAME` rather than the module's own: the name is the generated spec's, because it
    // is the contract with `TurboModuleRegistry.getEnforcing` on the JavaScript side. Kotlin does not
    // inherit a Java static, so it is read from where it is declared.
    override fun getModule(name: String, context: ReactApplicationContext): NativeModule? =
        if (name == NativeOtpSpec.NAME) OtpModule(context) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            NativeOtpSpec.NAME to ReactModuleInfo(
                NativeOtpSpec.NAME,
                NativeOtpSpec.NAME,
                false,
                false,
                false,
                true,
            ),
        )
    }
}
