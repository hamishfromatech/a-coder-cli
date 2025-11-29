#!/usr/bin/env python3
"""
Setup script for A-Coder CLI package
"""

from setuptools import setup, find_packages
import os

# Read the README file for long description
def read_readme():
    readme_path = os.path.join(os.path.dirname(__file__), 'README.md')
    if os.path.exists(readme_path):
        with open(readme_path, 'r', encoding='utf-8') as f:
            return f.read()
    return "A-Coder CLI - Terminal-based coding agent with OpenAI and MCP server support"

# Read requirements from requirements.txt
def read_requirements():
    requirements_path = os.path.join(os.path.dirname(__file__), 'requirements.txt')
    with open(requirements_path, 'r', encoding='utf-8') as f:
        return [line.strip() for line in f if line.strip() and not line.startswith('#')]

setup(
    name="a-coder-cli",
    version="1.0.0",
    author="The A-Tech Corporation",
    author_email="hamish@atech.industries",
    description="Terminal-based coding agent with OpenAI and MCP server support",
    long_description=read_readme(),
    long_description_content_type="text/markdown",
    url="https://github.com/hamishfromatech/a-coder-cli",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Topic :: Software Development :: Code Generators",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "Topic :: Text Editing :: Word Processors",
    ],
    python_requires=">=3.8",
    install_requires=read_requirements(),
    entry_points={
        "console_scripts": [
            "a-coder=a_coder_cli:main",
            "acoder=a_coder_cli:main",
        ],
    },
    py_modules=['a_coder_cli', 'config', 'voice_mode', 'tts_mode'],
    include_package_data=True,
    zip_safe=False,
    keywords="ai coding assistant mcp fastmcp openai terminal cli",
    project_urls={
        "Bug Reports": "https://github.com/morph-llm/a-coder-cli/issues",
        "Source": "https://github.com/morph-llm/a-coder-cli",
        "Documentation": "https://github.com/morph-llm/a-coder-cli#readme",
    },
)