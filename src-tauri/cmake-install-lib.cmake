# Fedora's GNUInstallDirs installs static libraries into lib64, but audiopus_sys only looks in
# lib, so the vendored libopus builds and then cannot be found. Pin it to lib everywhere.
set(CMAKE_INSTALL_LIBDIR lib CACHE PATH "Object code libraries")
