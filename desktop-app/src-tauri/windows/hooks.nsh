; Explorer integration: "Open with A-Coder Desktop" on a folder and on the
; background of an open folder. The app writes these HKCU keys at startup
; (src/launch.rs); the uninstaller removes them so no dead verbs remain.
!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\ACoderDesktop"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\ACoderDesktop"
!macroend
