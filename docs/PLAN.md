# A-Coder CLI Fork Implementation Plan

## Overview

This plan outlines the transformation of Qwen Code into A-Coder CLI, maintaining the exact same user experience while rebranding and configuring it to work with Ollama's OpenAI-compatible API.

## Project Goals

- ✅ **Same Experience**: Preserve all existing functionality and user workflows
- ✅ **Ollama Integration**: Configure for Ollama server at `https://ollama.hamishfromatech.com`
- ✅ **Model Configuration**: Default to `qwen3:14b` with full configurability
- ✅ **Complete Rebranding**: Transform all references from Qwen to Ollama
- ✅ **Maintain Architecture**: Keep the monorepo structure and tool ecosystem

## Implementation Strategy

### Phase 1: Core Configuration Changes

#### 1.1 Default Model & API Configuration
**Files to modify:**
- `packages/core/src/config/models.ts`
- `packages/core/src/core/contentGenerator.ts`
- `packages/core/src/core/openaiContentGenerator.ts`

**Changes:**
- Update `DEFAULT_GEMINI_MODEL` to `qwen3:14b`
- Set default `OPENAI_BASE_URL` to `https://ollama.hamishfromatech.com`
- Ensure OpenAI auth type is the primary method
- Remove Gemini-specific model fallbacks

#### 1.2 Environment Variable Defaults
**New environment variables:**
```bash
OLLAMA_API_BASE_URL=https://ollama.hamishfromatech.com
OLLAMA_MODEL=qwen3:14b
OLLAMA_API_KEY=ollama  # Default for local/basic setups
```

**Backward compatibility:**
- Still support `OPENAI_BASE_URL` and `OPENAI_MODEL`
- Ollama variables take precedence when present

### Phase 2: Package Rebranding

#### 2.1 Package Metadata Updates
**Files to modify:**
- Root `package.json`
- `packages/cli/package.json`
- `packages/core/package.json`
- `packages/vscode-ide-companion/package.json`

**Changes:**
- Package name: `@qwen-code/qwen-code` → `@a-coder-cli/a-coder-cli`
- Binary name: `qwen` → `ollama`
- Repository URLs and metadata
- Description and keywords

#### 2.2 Build Configuration Updates
**Files to modify:**
- `esbuild.config.js`
- `scripts/build.js`
- `scripts/prepare-package.js`
- `bundle/gemini.js` → `bundle/ollama.js`

### Phase 3: Code Rebranding

#### 3.1 Variable and Function Names
**Systematic replacements:**
- `gemini` → `ollama` (lowercase)
- `Gemini` → `Ollama` (capitalized)
- `GEMINI` → `OLLAMA` (uppercase)

**Key areas:**
- Class names: `GeminiClient` → `OllamaClient`
- File names: `gemini*.ts` → `ollama*.ts`
- Configuration directories: `.gemini/` → `.a-coder/`
- Memory files: `GEMINI.md` → `A-CODER.md`

#### 3.2 User-Facing Text Updates
**Files to modify:**
- All UI components in `packages/cli/src/ui/`
- Help text and error messages
- CLI command descriptions
- Progress indicators and loading text

### Phase 4: Documentation & Assets

#### 4.1 Documentation Updates
**Files to modify:**
- `README.md` - Complete rewrite for Ollama focus
- `docs/` directory - Update all documentation
- `CONTRIBUTING.md` - Update contribution guidelines
- Code comments and JSDoc

#### 4.2 Visual Assets
**Files to replace:**
- `docs/assets/qwen-screenshot.png` → `docs/assets/ollama-screenshot.png`
- Remove Qwen-specific branding images
- Update terminal themes if needed

#### 4.3 New Ollama-Specific Documentation
**New files to create:**
- `docs/ollama-setup.md` - Ollama server setup guide
- `docs/model-configuration.md` - Model selection and configuration
- `examples/ollama-workflows/` - Ollama-specific examples

### Phase 5: Configuration System Enhancement

#### 5.1 Config File Support
**New configuration files:**
```
.a-coder/
├── config.json          # Main configuration
├── models.json          # Available models configuration
└── servers.json         # Multiple Ollama server configs
```

**Configuration schema:**
```json
{
  "api": {
    "baseUrl": "https://ollama.hamishfromatech.com",
    "defaultModel": "qwen3:14b",
    "timeout": 30000,
    "maxRetries": 3
  },
  "models": {
    "code": "qwen3:14b",
    "chat": "llama3:8b",
    "embedding": "nomic-embed-text"
  },
  "servers": [
    {
      "name": "primary",
      "url": "https://ollama.hamishfromatech.com",
      "models": ["qwen3:14b", "llama3:8b"]
    }
  ]
}
```

#### 5.2 Environment Variable Priority
**Priority order:**
1. Command line arguments
2. `OLLAMA_*` environment variables
3. `OPENAI_*` environment variables (for compatibility)
4. Configuration file settings
5. Built-in defaults

### Phase 6: Testing & Quality Assurance

#### 6.1 Test Updates
**Files to modify:**
- All test files with Gemini/Qwen references
- Mock configurations for Ollama
- Integration tests for Ollama API compatibility

#### 6.2 New Test Coverage
- Ollama API integration tests
- Configuration system tests
- Multiple server support tests
- Model switching functionality

### Phase 7: Build & Distribution

#### 7.1 Build System Updates
**Scripts to modify:**
- `scripts/build.js` - Update build output paths
- `scripts/start.js` - Update development startup
- CI/CD workflows - Update for new package name

#### 7.2 Distribution Preparation
- Update npm publishing configuration
- Prepare Docker images if needed
- Update installation instructions

## Migration Guide for Users

### From Qwen Code to A-Coder CLI

1. **Installation:**
   ```bash
   npm uninstall -g @qwen-code/qwen-code
   npm install -g @a-coder-cli/a-coder-cli
   ```

2. **Command Change:**
   ```bash
   # Old
   qwen
   
   # New
   ollama
   ```

3. **Configuration Migration:**
   - Existing `.gemini/` directories will be automatically migrated to `.a-coder/`
   - Environment variables will be detected and migrated

## Technical Considerations

### API Compatibility
- Ollama's OpenAI-compatible API should work seamlessly with existing `OpenAIContentGenerator`
- May need minor adjustments for Ollama-specific features or limitations
- Test thoroughly with streaming responses and tool calls

### Memory Management
- Update memory file references from `GEMINI.md` to `A-CODER.md`
- Ensure memory discovery and import systems work with new paths
- Migrate existing memory files during upgrade

### Tool Integration
- All existing tools should work without modification
- MCP (Model Context Protocol) integration remains unchanged
- Shell commands and file operations remain identical

### Performance Considerations
- Ollama may have different token limits or performance characteristics
- Monitor and adjust timeout configurations as needed
- Consider caching strategies for model loading

## Risk Mitigation

1. **Backward Compatibility**: Maintain support for OpenAI environment variables
2. **Gradual Migration**: Allow users to gradually migrate configurations
3. **Comprehensive Testing**: Test all major workflows before release
4. **Documentation**: Provide clear migration guides and troubleshooting

## Success Criteria

- ✅ Complete rebranding with no Qwen/Gemini references
- ✅ Seamless integration with Ollama API
- ✅ All existing features work identically
- ✅ Configurable server and model selection
- ✅ Comprehensive documentation
- ✅ Smooth user migration path
- ✅ Maintained code quality and test coverage

## Timeline Estimate

- **Phase 1-2**: 1-2 days (Core config + Package changes)
- **Phase 3**: 2-3 days (Code rebranding)
- **Phase 4**: 1-2 days (Documentation + Assets)
- **Phase 5**: 2-3 days (Enhanced configuration)
- **Phase 6**: 2-3 days (Testing)
- **Phase 7**: 1 day (Build + Distribution)

**Total: 9-14 days**

## Next Steps

1. Begin with Phase 1 (Core Configuration Changes)
2. Set up test Ollama server for validation
3. Create feature branch for development
4. Implement changes incrementally with testing
5. Update documentation throughout development
6. Prepare for user testing and feedback

---

*This plan ensures a complete transformation while maintaining the excellent user experience that makes this tool valuable.*