# Clean old builds
rm -rf dist/*

# Build new version
python -m build

# Upload to TestPyPI
python -m twine upload --repository testpypi dist/a_coder_cli-1.0.4*