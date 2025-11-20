# Clean old builds
rm -rf dist/*

# Build new version
python -m build

# Upload to TestPyPI
python -m twine upload --repository testpypi dist/a_coder_cli-1.2.7*

# Install from TestPyPI (for testing)
pip install --index-url https://test.pypi.org/simple/ a-coder-cli

# --- PRODUCTION DEPLOYMENT ---

# Upload to Production PyPI
python -m twine upload dist/a_coder_cli-1.1.6*

# Install from Production PyPI
pip install a-coder-cli

# Verify installation
a-coder --version