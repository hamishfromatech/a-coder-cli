# A-Coder CLI: Audit & Critique Report
**Date**: March 15, 2026
**Platform**: Terminal UI (TUI) - macOS/Linux/Windows
**Frameworks**: React + Ink

---

## Executive Summary

### Overall Assessment
The A-Coder CLI is a **functional and powerful** developer tool with solid architecture, but suffers from **visual inconsistency** and **decorative overuse** that diminish its perceived quality. The theming system and workflow features are strong, but the experience is hampered by AI-generated aesthetic choices (gradients on functional elements, generic emojis) and discoverability issues with key features.

### Key Metrics
- **Total Issues Found**: 18
  - Critical: 2
  - High: 5
  - Medium: 7
  - Low: 4
- **Main Strengths**: Theming system, input buffer architecture, context awareness
- **Main Weaknesses**: Decorative noise, inconsistent dialog UX, hidden features
- **Overall Quality Score**: 7.2/10

### Priority Recommendations
1. **Remove decorative gradients** from functional text (Header/Footer)
2. **Unify iconography** away from generic emojis toward purposeful markers
3. **Improve discoverability** of hidden features (Ctrl+O, Ctrl+T)
4. **Normalize dialog patterns** for consistent spacing and focus states
5. **Clarify loading states** to reduce cognitive load

---

## AI Slop Verdict (CRITICAL)

### Result: ⚠️ PARTIAL FAIL

This CLI exhibits several AI-generation fingerprints:

**Present AI Slop Patterns:**
- ✗ **Gradient text on functional elements** - Header version and footer path use gradients without purpose
- ✗ **Generic emoji icons** - 👑, ❯, ⚡ used ubiquitously, no unique identity
- ✗ **Card-like containers** - Repeated borders and containers create visual noise
- ✗ **Decorative over functional** - Gradients applied without serving hierarchy needs

**Avoided AI Slop Patterns:**
- ✓ No glassmorphism (not applicable to CLI context)
- ✓ No "AI color palette" - proper theming system in place
- ✓ No hero metric layout templates
- ✓ Color palette rooted in established themes (Dracula, etc.)

**The Test:**
If shown this CLI and told "This was AI-generated," would I believe it? **YES**. The gradient text and emoji usage are tell-tale signs of 2024-2025 AI-generated design.

---

## Detailed Findings by Severity

### 🔴 Critical Issues

#### 1. Gradient Text on Functional Elements
- **Location**: `src/ui/components/Header.tsx` line 44-47, `src/ui/components/Footer.tsx` line 65-69
- **Severity**: Critical
- **Category**: Theming / Anti-Patterns
- **Description**: Gradient colors applied to version numbers, paths, and ASCII art using `ink-gradient`. Gradients are purely decorative on information-dense elements.
- **Impact**:
  - Reduces readability in many terminals (gradients render poorly on mono displays)
  - Bypasses the semantic color system, breaking theme consistency
  - Adds no functional value - pure "AI slop" decoration
- **WCAG/Standard**: While CLI doesn't have WCAG, this violates accessibility best practices for terminal applications (low contrast between gradient transitions)
- **Recommendation**: Replace gradients with bold semantic colors. Use `Semantic.Primary` or `Semantic.Info` with bold weight for emphasis.
- **Suggested Command**: `/distill` to remove decorative gradients, `/normalize` to align with semantic colors

#### 2. Generic Emoji Iconography Without Brand Identity
- **Location**: Throughout `src/ui/components/` - Emoji usage in `GeminiMessage.tsx` (👑), `UserMessage.tsx` (❯), `ErrorMessage.tsx` (⚠️), `Footer.tsx` (▼, ▲)
- **Severity**: Critical
- **Category**: Anti-Patterns / Brand Identity
- **Description**: Heavy use of standard Unicode emojis as icons. No custom ASCII art or consistent icon language. Emojis vary across terminals/OS, creating inconsistent experience.
- **Impact**:
  - Breaks consistency - same user sees different icons on different platforms
  - Feels generic and unpolished, like a default template
  - No unique brand identity - could be any CLI tool
  - Screen readers announce emoji names, reducing clarity
- **Recommendation**:
  - Replace with purposeful text markers: `[AI]`, `[YOU]`, `[!WARN!]`, `[DEBUG]`
  - Or use consistent ASCII symbols: `▶`, `◆`, `⚡`, `▴`
  - Commit to ONE icon language across the UI
- **Suggested Command**: `/normalize` for consistent icon system, `/clarify` for clearer markers

---

### 🟠 High-Severity Issues

#### 3. Dialog Visual Hierarchy Inconsistency
- **Location**: `ThemeDialog.tsx`, `ModelDialog.tsx`, `AuthDialog.tsx`
- **Severity**: High
- **Category**: Visual Hierarchy / UX
- **Description**: Different dialogs use different patterns for focus indicators, spacing, and labeling:
  - ThemeDialog uses `> ` prefix for active selection
  - ModelDialog uses similar but with different bold/color patterns
  - Tab focus switching is jarring - no clear visual transition
- **Impact**:
  - Users can't quickly understand what's active in multi-section dialogs
  - Inconsistent spacing creates visual noise
  - Learning curve for each dialog type
- **Recommendation**:
  - Standardize focus indicator: `▶` or `●` for active, `  ` for inactive
  - Use consistent color mapping: active = `Semantic.Primary`, inactive = `Semantic.Muted`
  - Add clear visual border or background change when switching tab focus
  - Ensure consistent padding across all dialogs
- **Suggested Command**: `/normalize` to unify dialog patterns, `/polish` for spacing fixes

#### 4. Hidden Interaction Features with Poor Discoverability
- **Location**: `App.tsx` lines 617-634 (Ctrl+O, Ctrl+E, Ctrl+T)
- **Severity**: High
- **Category**: Discoverability / Information Architecture
- **Description**: Powerful features hidden behind keybindings:
  - `Ctrl+O`: Toggle thinking/reasoning display
  - `Ctrl+E`: Toggle error details
  - `Ctrl+T`: Toggle tool descriptions
  - Only hinted via microcopy in specific states
- **Impact**:
  - Users miss powerful contextual features entirely
  - No way to discover these without reading source code
  - Reduces perceived value of tool
- **Recommendation**:
  - Add persistent hint in footer: "? for shortcuts" or "Press ? for help"
  - Create keyboard shortcut overlay dialog accessible via `/shortcuts` or `?`
  - Mention shortcuts in tips or onboarding
  - Add inline hints when relevant state is active
- **Suggested Command**: `/onboard` to surface shortcuts, `/clarify` to improve hints

#### 5. Loading State Clutter and Cognitive Overload
- **Location**: `LoadingIndicator.tsx` lines 18-70
- **Severity**: High
- **Category**: Visual Hierarchy / Cognitive Load
- **Description**: Loading indicator displays spinner + phrase + elapsed time + optional hint + rightContent simultaneously in a single area. Line wrapping in small terminals creates chaos.
- **Impact**:
  - Users must parse multiple pieces of info at once
  - On small terminals, wrapping makes layout unclear
  - Doesn't clearly indicate what to wait for
- **Recommendation**:
  - Simplify to: spinner + primary phrase (one line)
  - Move elapsed time to separate line, only show after 5 seconds
  - Keep thought hint separate, only show when active
  - Use color to convey urgency/status
- **Suggested Command**: `/distill` to reduce clutter, `/polish` for clean layout

#### 6. Inconsistent Border Styling
- **Location**: Various components - `InputPrompt.tsx` (round), `ThemeDialog.tsx` (round), dialogs vary
- **Severity**: High
- **Category**: Visual Consistency / Theming
- **Description**: Mix of `round` and `single` border styles without clear rationale. No theming integration for border styles.
- **Impact**:
  - Inconsistent visual language
  - Round borders waste horizontal space in narrow terminals
  - Can create alignment issues
- **Recommendation**:
  - Use `single` borders for all dialogs/modal overlays
  - Use `round` only for main input prompt
  - Consider theme system for border style per theme
  - Document border style guideline
- **Suggested Command**: `/normalize` for consistent borders

#### 7. Footer Information Overload
- **Location**: `Footer.tsx` - displays path, sandbox, model, context, corgi mode, errors, memory usage
- **Severity**: High
- **Category**: Visual Hierarchy / Information Architecture
- **Description**: Footer displays up to 7 pieces of information in one row. On narrow terminals, elements wrap or get truncated unpredictably.
- **Impact**:
  - Difficult to scan for crucial information (context usage, errors)
  - Wrapping can break layout at certain terminal widths
  - No clear information prioritization
- **Recommendation**:
  - Group information: [Path + Sandbox] | [Model + Context] | [Status indicators]
  - Use truncation elegantly: "src/.../project" instead of "/.../.../..."
  - Consider hiding less critical info (memory usage) in normal mode
  - Use color to highlight urgent info (context at 90%, errors)
- **Suggested Command**: `/normalize` for consistent grouping, `/polish` for truncation

---

### 🟡 Medium-Severity Issues

#### 8. Suggestion Display Overruns Viewport
- **Location**: `SuggestionsDisplay.tsx`, `InputPrompt.tsx` completion logic
- **Severity**: Medium
- **Category**: Responsive / UX
- **Description**: Autocomplete suggestions can dominate the viewport in long lists, scroll behavior inconsistent, no max height constraint.
- **Impact**:
  - Obscures other UI elements when triggered
  - Can make terminal feel cramped
  - Scroll arrows may not be obvious
- **Recommendation**:
  - Hard max height of 8-10 items
  - Always show scroll indicators when truncated
  - Consider "show 8 of 42" counter
- **Suggested Command**: `/polish` for consistent suggestion behavior

#### 9. Context File List Not Truncated Effectively
- **Location**: `ContextSummaryDisplay.tsx`
- **Severity**: Medium
- **Category**: Information Density / UX
- **Description**: Long lists of context files (from `config.getExtensionContextFilePaths()`) can dominate the UI, no truncation strategy shown.
- **Impact**:
  - Obscures important information when many files loaded
  - Can trigger wrapping issues
- **Recommendation**:
  - Show first 3 files: "file.ts, util.ts, helper.ts"
  - Truncate with count: "... +5 more files"
  - Add hover/expand interaction if needed
- **Suggested Command**: `/polish` for better truncation

#### 10. Tab Focus Mental Model Issues
- **Location**: `ThemeDialog.tsx`, `ModelDialog.tsx` - Section switching via Tab
- **Severity**: Medium
- **Category**: UX / Interaction Design
- **Description**: Tab switches between "theme selection" and "apply to scope". No visual signal that there are multiple interactive sections without trial.
- **Impact**:
  - Users may not realize they can change scope
  - Can accidentally submit to wrong scope
  - Unclear what "focus" means in this context
- **Recommendation**:
  - Add explicit indicator: "[Tab] Switch between sections"
  - Consider separate "Scope" step after theme selection instead of inline
  - Add visual separation between sections
- **Suggested Command**: `/clarify` for better UX, `/onboard` for guidance

#### 11. Error Messages Could Be More Actionable
- **Location**: `ErrorMessage.tsx`, various error display components
- **Severity**: Medium
- **Category**: UX Writing / Error Handling
- **Description**: Error messages show what went wrong but often not exactly how to fix it. Generic errors ("Initialization Error") lack context.
- **Impact**:
  - Users stuck without clear next steps
  - Frustration when errors occur
- **Recommendation**:
  - Always include specific actionable step: "API key missing. Run `/auth` or check config."
  - Use error codes for documentation lookup
  - Provide "help" link for common errors
- **Suggested Command**: `/harden` for better error states, `/clarify` for actionability

#### 12. No Empty States Guidance
- **Location**: App initialization, first run
- **Severity**: Medium
- **Category**: Onboarding / States
- **Description**: No explicit empty state on first load showing what to do. Tips are shown but not clearly a "getting started" guide.
- **Impact**:
  - New users unsure what to type first
  - Missed opportunity for onboarding
- **Recommendation**:
  - Show "Type a message or paste code to get started" explicitly
  - Add sample queries in tips
  - Consider `/tutorial` command for walkthrough
- **Suggested Command**: `/onboard` for better empty states

#### 13. Theme Preview Shows Only Python Code
- **Location**: `ThemeDialog.tsx` - Hardcoded Python function in preview
- **Severity**: Medium
- **Category**: Theming / UX
- **Description**: Theme preview always shows same Python function regardless of user's primary language. Diff preview is static.
- **Impact**:
  - Doesn't reflect user's actual working context
  - Less useful for users who don't use Python
- **Recommendation**:
  - Offer language selection in preview (JS, TypeScript, Python, Go, Rust)
  - Or detect from most common files in project
  - Show user's own code if available (maybe too complex)
- **Suggested Command**: `/adapt` for context-aware previews

#### 14. Corgi Mode Easter Egg Undermines Professional Tone
- **Location**: `Footer.tsx` lines 89-94, `App.tsx` line 434
- **Severity**: Medium
- **Category**: Brand / Professionalism
- **Description**: Hidden "corgi mode" toggle (Ctrl+C sequence) adds decorative corgi ASCII to footer. Fun but undermines professional tool perception.
- **Impact**:
  - Confused users who accidentally activate it
  - Reduces perceived professionalism
  - Inconsistent with "privacy/security" brand
- **Recommendation**:
  - Remove or make opt-in via explicit `/easter-egg` command
  - Keep if core part of brand identity (commit to it fully)
  - Otherwise, remove hidden toggles that change UI unexpectedly
- **Suggested Command**: `/distill` to remove easter eggs, `/normalize` for consistent tone

---

### 🟢 Low-Severity Issues

#### 15. Hardcoded Prefix Widths Can Cause Misalignment
- **Location**: `GeminiMessage.tsx` (`👑 `), `UserMessage.tsx` (`❯ `), other message components
- **Severity**: Low
- **Category**: Visual Consistency / Responsive
- **Description**: Prefix emojis have fixed character width assumption. In terminals where emoji rendering varies, alignment breaks.
- **Impact**:
  - Visual inconsistency on rare terminals
  - Usually works but edge case exists
- **Recommendation**:
  - Use `flexGrow` container with `minWidth` instead of fixed width
  - Or use text-based markers with consistent width
- **Suggested Command**: `/polish` for robust alignment

#### 16. ShowMoreLines Not Clearly Indicated
- **Location**: `ShowMoreLines.tsx`
- **Severity**: Low
- **Category**: UX / Visual Hierarchy
- **Description**: "Show more lines" functionality exists but the affordance (what to click/press) isn't clearly indicated in UI.
- **Impact**:
  - Users may not know content is truncated
  - Missed opportunity to guide interaction
- **Recommendation**:
  - Clear "↓ Expand (Ctrl+Down)" indicator when truncated
  - Use semantic color to indicate expandable content
- **Suggested Command**: `/clarify` for better affordances

#### 17. No Loading Phrases for Disabled Accessibility
- **Location**: `App.tsx` line 1059-1060
- **Severity**: Low
- **Category**: Accessibility / UX
- **Description**: Loading phrases disabled when `disableLoadingPhrases` setting is true, but no alternative state shown.
- **Impact**:
  - Users with this setting see no loading feedback
  - Confusing if system appears hung
- **Recommendation**:
  - Always show spinner even when phrases disabled
  - Or show "AI thinking..." static phrase
- **Suggested Command**: `/harden` for better accessibility support

#### 18. Branch Name Display Uses Asterisk for All Branches
- **Location**: `Footer.tsx` line 47
- **Severity**: Low
- **Category**: Git Integration / UX
- **Description**: Shows `(branchName*)` regardless of whether branch has uncommitted changes. Asterisk is misleading git UX.
- **Impact**:
  - Misleading git status indication
  - Git users expect asterisk to mean "dirty working directory"
- **Recommendation**:
  - Remove asterisk always
  - Or show asterisk conditionally based on git status check
- **Suggested Command**: `/polish` for accurate git indication

---

## Patterns & Systemic Issues

### 1. Decorative Overkill
**Pattern**: Gradients and emojis used as decoration rather than communication
- Affected areas: Header, Footer, Message prefixes, Loading state
- Root cause: AI-generation aesthetic imprint
- Impact: Reduces perceived quality, feels generic

### 2. Inconsistent Dialog Patterns
**Pattern**: Each dialog implements focus, spacing, and borders independently
- Affected areas: ThemeDialog, ModelDialog, AuthDialog, SkillsDialog
- Root cause: No dialog component library or strict guidelines
- Impact: Inconsistent UX, higher learning curve

### 3. Semantic Color Under-Utilization
**Pattern**: Some components use direct color values instead of `Semantic.*` keys
- Affected areas: Theme previews, some hardcoded color references
- Root cause: Gradual migration to semantic system incomplete
- Impact: Theme inconsistencies, maintenance burden

### 4. Hidden Power User Features
**Pattern**: Powerful features hidden behind keybindings without discoverability
- Affected areas: Thinking display (Ctrl+O), error details (Ctrl+E), tool descriptions (Ctrl+T)
- Root cause: Minimalist onboarding, assumption users read docs
- Impact: Features go unused, reduced perceived value

### 5. Terminal Size Assumptions
**Pattern**: Some assume minimum terminal width without graceful degradation
- Affected areas: Dialog columns, footer layout, suggestions
- Root cause: Testing on larger screens primarily
- Impact: Breaks on narrow terminals (80 columns or less)

---

## Positive Findings

### What's Working Well

1. **Excellent Theming System**
   - Semantic colors with clear intent (Success, Warning, Error, Info, Primary, Secondary, Muted)
   - Multiple themes (Dracula, GitHub, Atom One, Ayu, Ollama variants)
   - Theme switching works seamlessly
   - This is a strong foundation

2. **Robust Input Architecture**
   - Multiline text buffer with proper navigation
   - History navigation works intuitively
   - Tab completion for paths and commands
   - External editor integration (Ctrl+X)
   - Bracketed paste support

3. **Context Awareness**
   - Footer shows context usage with color-coded urgency
   - Context file list prominent
   - Model selection aware of context
   - This is genuinely valuable features

4. **Keyboard Shortcut Design**
   - Ctrl+L for clear screen (standard)
   - Ctrl+C/Ctrl+D for exit with confirmation
   - Ctrl+S for constraint height toggle
   - Escape cancels most operations
   - Well-chosen shortcuts with good patterns

5. **Code Colorization**
   - Syntax highlighting works well
   - Multiple language support
   - Theme-aware code colors
   - Diff rendering is clear

6. **Privacy-Focused Design**
   - Local Ollama support
   - Clear privacy notices
   - No data leaving system indication
   - This is the core differentiator and well-executed

---

## Recommendations by Priority

### Immediate (This Sprint)

1. **Remove decorative gradients** from Header and Footer
   - Replace with bold semantic colors
   - Improves readability and removes AI slop
   - **Effort**: Low | **Impact**: High

2. **Unify iconography system**
   - Choose ONE icon language (text, ASCII, or emoji)
   - Replace generic emojis with consistent markers
   - **Effort**: Medium | **Impact**: High

3. **Add help discoverability**
   - Add "Press ? for shortcuts" hint in footer
   - Create `/shortcuts` command or `?` keybinding
   - **Effort**: Low | **Impact**: High

### Short-Term (This Sprint or Next)

4. **Normalize dialog patterns**
   - Standardize focus indicators and spacing
   - Unify border styles (single for dialogs)
   - **Effort**: Medium | **Impact**: Medium

5. **Simplify loading state**
   - Reduce to spinner + phrase
   - Move detail info to separate lines
   - **Effort**: Low | **Impact**: Medium

6. **Fix footer information density**
   - Group related info
   - Improve truncation
   - **Effort**: Low | **Impact**: Medium

### Medium-Term (Next Sprint)

7. **Improve suggestion display**
   - Add max height constraint
   - Better scroll indicators
   - **Effort**: Low | **Impact**: Low

8. **Enhance error messages**
   - Add actionable guidance
   - Link to documentation
   - **Effort**: Medium | **Impact**: Medium

9. **Add empty state guidance**
   - Clear getting started message
   - Sample queries
   - **Effort**: Low | **Impact**: Medium

### Long-Term (Future Enhancements)

10. **Context-aware theme previews**
    - Show user's actual code languages
    - **Effort**: High | **Impact**: Low

11. **Comprehensive onboarding**
    - `/tutorial` command
    - Progressive tips
    - **Effort**: High | **Impact**: Medium

---

## Suggested Commands for Fixes

Based on the loaded skills system, here are the recommended commands to address issues:

### High-Impact Commands

- **`/normalize`** - Use for: unify iconography, dialog patterns, border styles
- **`/distill`** - Use for: remove decorative gradients, simplify loading state, remove easter eggs
- **`/clarify`** - Use for: replace emojis with clearer markers, improve help discoverability, enhance error messages
- **`/onboard`** - Use for: surface keyboard shortcuts, add empty state guidance, create tutorial

### Medium-Impact Commands

- **`/polish`** - Use for: fix dialog spacing, implement truncation, improve footer grouping, alignment fixes
- **`/harden`** - Use for: better error states, accessibility improvements, loading feedback when phrases disabled
- **`/adapt`** - Use for: context-aware theme previews

---

## Questions to Consider

### for Hamish (User/Developer)

1. **Brand Identity**: What emotion should the CLI evoke? Privacy & security? Speed & precision? Community & collaboration? Let's pick ONE and commit to it.

2. **Aesthetic Direction**: Do you want a minimal, "tools-just-work aesthetic like git/tmux" OR a "playful, expressive identity" OR something else different?

3. **Gradient Rationale**: Are gradients a deliberate design choice for specific meaning (e.g., nightly builds = gradient) or just decoration? If decoration, they should go.

4. **Icon Language**: Given this is a CLI for developers, would you prefer a **minimal ASCII** approach (▶, ◆, ✕, ✓) or **text-based** ([AI], [YOU], [WARN])? Emojis don't fit the developer tool aesthetic.

5. **Discoverability Philosophy**: Should "power user features" be hidden and require documentation, or always surfaceable via hints? The current approach hides too much.

---

## Conclusion

The A-Coder CLI is fundamentally **sound with excellent architecture** - the theming system, input handling, and context awareness are genuinely valuable features. However, the experience suffers from **aesthetic inconsistencies** and **AI-generation baggage** that reduce its perceived quality.

The main opportunity area is **intent vs. decoration**. The CLI would feel dramatically more professional and trustworthy if gradients were removed, iconography unified, and a clear aesthetic direction chosen - either brutal minimal or playful expressive, but not both at random.

**Recommended Starting Point:**
1. Remove gradient decorations from Header/Footer (30 minutes)
2. Choose icon language and apply consistently (1-2 hours)
3. Add "?" shortcut hint in footer (15 minutes)

These three changes would immediately elevate the experience from "functional tool" to "designed product" with minimal effort.

---

**Report generated using audit and critique skills**
**Next steps**: Review recommendations, prioritize based on user feedback, and apply using suggested commands