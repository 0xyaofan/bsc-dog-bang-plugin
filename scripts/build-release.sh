#!/bin/bash

# BSC Dog Bang Plugin - Release Build Script
# This script automates the release packaging process

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the project root
if [ ! -f "package.json" ]; then
    log_error "package.json not found. Please run this script from the project root."
    exit 1
fi

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
MANIFEST_VERSION=$(node -p "require('./extension/manifest.json').version")

log_info "Building BSC Dog Bang Plugin v${VERSION}"

# Verify version consistency
if [ "$VERSION" != "$MANIFEST_VERSION" ]; then
    log_error "Version mismatch!"
    echo "  package.json: $VERSION"
    echo "  manifest.json: $MANIFEST_VERSION"
    echo ""
    echo "Please update both files to the same version."
    exit 1
fi

# Create release directory
RELEASE_DIR="release"
mkdir -p "$RELEASE_DIR"

# Clean old builds
log_info "Cleaning old builds..."
rm -rf extension/dist
rm -rf "$RELEASE_DIR"/*

# Install dependencies (optional, skip if already installed)
if [ "$1" != "--skip-install" ]; then
    log_info "Installing dependencies..."
    npm ci
else
    log_warn "Skipping dependency installation (--skip-install flag)"
fi

# Type check
log_info "Running TypeScript type check..."
npx tsc --noEmit

# Build the extension
log_info "Building extension..."
npm run build

# Verify build outputs
log_info "Verifying build outputs..."
required_files=(
    "extension/dist/background.js"
    "extension/dist/content.js"
    "extension/dist/offscreen.js"
    "extension/dist/popup.html"
    "extension/dist/sidepanel.html"
    "extension/manifest.json"
)

for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        log_error "Required file not found: $file"
        exit 1
    fi
done

log_info "All required files present"

# Create zip package
PACKAGE_NAME="bsc-dog-bang-plugin-v${VERSION}.zip"
PACKAGE_PATH="$RELEASE_DIR/$PACKAGE_NAME"
log_info "Creating release package: $PACKAGE_PATH"

cd extension
zip -r "../$PACKAGE_PATH" . \
    -x "*.DS_Store" \
    -x "__MACOSX*" \
    -x "dist/.vite/*" \
    -x "*.map" \
    > /dev/null 2>&1
cd ..

# Generate checksums
log_info "Generating checksums..."
if command -v sha256sum &> /dev/null; then
    sha256sum "$PACKAGE_PATH" > "$RELEASE_DIR/checksums.txt"
elif command -v shasum &> /dev/null; then
    shasum -a 256 "$PACKAGE_PATH" > "$RELEASE_DIR/checksums.txt"
else
    log_warn "sha256sum/shasum not found, skipping checksum generation"
fi

# Display package info
log_info "Package created successfully!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Package: $PACKAGE_PATH"
echo "  Size: $(du -h "$PACKAGE_PATH" | cut -f1)"
if [ -f "$RELEASE_DIR/checksums.txt" ]; then
    echo "  SHA256: $(cut -d' ' -f1 "$RELEASE_DIR/checksums.txt")"
fi
echo "  Location: $RELEASE_DIR/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# List release files
log_info "Release files:"
ls -lh "$RELEASE_DIR"
echo ""

# List package contents
log_info "Package contents (first 20 files):"
unzip -l "$PACKAGE_PATH" | head -n 25

# Pre-release checklist
echo ""
log_info "Pre-release checklist:"
echo ""
echo "  [ ] Version updated in package.json and manifest.json"
echo "  [ ] CHANGELOG.md updated"
echo "  [ ] All features tested"
echo "  [ ] No debug code (console.log, debugger)"
echo "  [ ] Documentation updated"
echo "  [ ] .env file excluded"
echo "  [ ] Git committed and tagged"
echo ""

# Next steps
log_info "Next steps:"
echo ""
echo "  1. Test the packaged extension:"
echo "     - Extract to a directory"
echo "     - Load in Chrome (chrome://extensions/)"
echo "     - Test all features"
echo ""
echo "  2. Create git tag:"
echo "     git tag -a v${VERSION} -m \"Release version ${VERSION}\""
echo "     git push origin v${VERSION}"
echo ""
echo "  3. Create GitHub Release:"
echo "     - Go to https://github.com/0xyaofan/bsc-dog-bang-plugin/releases/new"
echo "     - Select tag v${VERSION}"
echo "     - Upload files from $RELEASE_DIR/"
echo "       - $PACKAGE_NAME"
echo "       - checksums.txt"
echo "     - Copy release notes from CHANGELOG.md"
echo ""

log_info "Build complete! ✨"
