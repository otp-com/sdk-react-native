require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'OtpReactNative'
  s.version      = package['version']
  s.summary      = package['description']
  s.homepage     = 'https://otp.com'
  s.license      = { type: 'Apache-2.0', file: 'LICENSE' }
  s.authors      = { 'otp.com' => 'support@otp.com' }
  s.source       = { git: 'https://github.com/otp-com/sdk-react-native.git', tag: s.version.to_s }

  # The floor is the iOS SDK's, not React Native's. See the README: it is the minimum the drop-in
  # screen's SwiftUI needs, and a published minimum is a promise rather than a detail.
  s.platforms    = { ios: '15.0' }
  s.source_files = 'ios/**/*.{h,m,mm,swift}'

  # The native SDK this package is a bridge over. A version bound rather than the exact version: the
  # three platforms move their minor together, and a patch of the iOS SDK is not a release of this.
  s.dependency 'Otp', "~> #{s.version.to_s.split('.').first(2).join('.')}"

  # Wires up React Native itself, the New Architecture, and the codegen output for `OtpSpec`. It comes
  # from the React Native version the app resolved, so this file states no React version of its own.
  install_modules_dependencies(s)

  # Swift and Objective-C++ in one pod: the generated module protocol is Objective-C++ and the SDK is
  # Swift, so the bridge has a half in each. DEFINES_MODULE is what makes the Swift half's generated
  # header importable from the Objective-C++ half.
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_OBJC_INTERFACE_HEADER_NAME' => 'OtpReactNative-Swift.h'
  }
end
