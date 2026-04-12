Unicode True
ManifestDPIAware True

!define APP_NAME "Meeting Float"
!ifndef APP_VERSION
!define APP_VERSION "0.1.0"
!endif
!define APP_PUBLISHER "OpenAI Codex"
!define APP_EXE "Meeting Float.exe"
!define DIST_DIR "..\dist\win-x64"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"

Name "${APP_NAME}"
OutFile "..\dist\Meeting-Float-${APP_VERSION}-Setup.exe"
InstallDir "$LocalAppData\Meeting Float"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel user

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${DIST_DIR}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Meeting Float"
  CreateShortcut "$SMPROGRAMS\Meeting Float\Meeting Float.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\Meeting Float\Mock Autotest.lnk" "$WINDIR\System32\wscript.exe" "$INSTDIR\Mock Autotest.vbs"
  CreateShortcut "$SMPROGRAMS\Meeting Float\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Meeting Float.lnk" "$INSTDIR\${APP_EXE}"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" "$INSTDIR\Uninstall.exe /S"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Meeting Float.lnk"
  Delete "$SMPROGRAMS\Meeting Float\Meeting Float.lnk"
  Delete "$SMPROGRAMS\Meeting Float\Mock Autotest.lnk"
  Delete "$SMPROGRAMS\Meeting Float\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Meeting Float"

  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"

  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
