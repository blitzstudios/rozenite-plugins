require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "RozenitePluginInput"
  s.version      = package["version"]
  s.license      = package["license"]
  s.summary      = package["description"]
  s.author       = "Blitz Studios, Inc."
  s.homepage     = "https://github.com/blitzstudios/rozenite-plugins"
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/blitzstudios/rozenite-plugins.git", :tag => "rozenite-plugin-input-v#{s.version}-gitpkg" }

  # Compiled only in Debug: it drives UIKit through private API.
  s.source_files = "ios/**/*.{h,m}"
  s.dependency "React-Core"
end
