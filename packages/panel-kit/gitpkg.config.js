// Tags without the npm scope: `rozenite-panel-kit-v1.0.0-gitpkg`. gitpkg only reads a config exported as a function.
module.exports = () => ({
  getTagName: (pkg) => `${pkg.name.replace(/^@[^/]+\//, '')}-v${pkg.version}-gitpkg`,
});
