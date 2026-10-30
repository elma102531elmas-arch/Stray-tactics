#!/bin/sh
# Builds the experimental "STRIKE POINT TEST" file (zombie mode, skins, karambit / butterfly) from the main game.
# The main game keeps TEST_BUILD=false; this copy flips it to true. Run from the repo root after changing stray-tactical.html.
set -e
cd "$(dirname "$0")/.."
grep -q 'const TEST_BUILD=false;' stray-tactical.html
sed -e 's/const TEST_BUILD=false;/const TEST_BUILD=true;/' -e 's#<title>[^<]*</title>#<title>STRIKE POINT TEST</title>#' stray-tactical.html > strike-point-test.html
grep -q 'const TEST_BUILD=true;' strike-point-test.html
echo "strike-point-test.html built"
