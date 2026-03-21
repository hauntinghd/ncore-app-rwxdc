!macro _killNcoreRuntimeProcesses
  ; Force-stop any lingering runtime processes so update install does not block
  ; when NCore is running headless in tray/background mode.
  nsExec::ExecToLog 'taskkill /F /T /IM "NCore.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM "Cordty Nano.exe"'
  Pop $0
  ; Electron subprocesses that can keep files locked during update uninstall.
  nsExec::ExecToLog 'taskkill /F /T /IM "crashpad_handler.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM "NCore Helper.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM "NCore Helper (Renderer).exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM "NCore Helper (GPU).exe"'
  Pop $0
  Sleep 1500
!macroend

!macro _runUninstallFallback
  !insertmacro _killNcoreRuntimeProcesses

  StrCpy $R1 1
  ; Last resort: remove the target install dir directly if silent uninstaller path fails.
  ${if} $INSTDIR != ""
  ${andIf} ${FileExists} "$INSTDIR\*.*"
    DetailPrint `Fallback removing installation directory: $INSTDIR`
    RMDir /r "$INSTDIR"
    IfErrors +4 0
      DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"
      DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"
      StrCpy $R1 0
      DetailPrint `Fallback directory cleanup succeeded.`
    IfErrors 0 +2
      DetailPrint `Fallback directory cleanup failed.`
  ${else}
    StrCpy $R1 0
  ${endif}

  ${if} $R1 == 0
    StrCpy $R0 0
    ClearErrors
  ${endif}
!macroend

!macro customInit
  !insertmacro _killNcoreRuntimeProcesses
!macroend

!macro customUnInstallCheck
  ${if} $R0 != 0
    DetailPrint `Primary uninstall returned $R0. Trying fallback path...`
    !insertmacro _runUninstallFallback
  ${endif}
  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful after fallback. Error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endif}
!macroend

!macro customUnInstallCheckCurrentUser
  ${if} $R0 != 0
    DetailPrint `Primary current-user uninstall returned $R0. Trying fallback path...`
    !insertmacro _runUninstallFallback
  ${endif}
  ${if} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Current-user uninstall was not successful after fallback. Error code: $R0.`
    SetErrorLevel 2
    Quit
  ${endif}
!macroend
