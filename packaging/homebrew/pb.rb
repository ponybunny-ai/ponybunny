class Pb < Formula
  desc "PonyBunny CLI"
  homepage "https://github.com/DarkhorseOne/PonyBunny"
  url "https://registry.npmjs.org/ponybunny/-/ponybunny-1.0.0.tgz"
  sha256 "REPLACE_WITH_NPM_TARBALL_SHA256"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink libexec/"bin/pb"
  end

  test do
    assert_match "Usage", shell_output("#{bin}/pb --help")
  end
end
