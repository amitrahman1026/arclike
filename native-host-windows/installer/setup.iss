; Inno Setup script for Arclike on Windows. build.ps1 -Installer runs it and passes the version:
;   iscc /DMyAppVersion=0.2.0 setup.iss
; It installs for the current user only, so it needs no administrator rights.

#define MyAppName "Arclike"
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppPublisher "Amit Rahman"
#define MyAppURL "https://github.com/amitrahman1026/arclike"
#define MyAppExeName "Arclike.exe"
#define HostName "com.amitrahman1026.arclike"
#define ExtensionId "jlmidbafifiahhcpahkcejphlibhjapo"

[Setup]
AppId={{3F7C2E1A-9B4D-4E8F-A6C5-2D1B0E9F8A7C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=..\dist
OutputBaseFilename=Arclike-{#MyAppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Chrome keeps Arclike.exe running. Close it to replace it. The extension starts the new one.
CloseApplications=force
RestartApplications=no
SetupIconFile=..\Arclike\Resources\app-icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "..\dist\publish\*"; DestDir: "{app}"; Excludes: "*.pdb"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; The native messaging host for each Chromium browser. The [Code] section writes the manifest.
Root: HKCU; Subkey: "SOFTWARE\Google\Chrome\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "SOFTWARE\Microsoft\Edge\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "SOFTWARE\BraveSoftware\Brave-Browser\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "SOFTWARE\Vivaldi\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "SOFTWARE\Chromium\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey

[UninstallDelete]
Type: files; Name: "{app}\{#HostName}.json"

[Run]
; Opened directly, Arclike shows its setup window, which says what to do next.
Filename: "{app}\{#MyAppExeName}"; Description: "Open Arclike setup"; Flags: nowait postinstall skipifsilent

[Code]
// Write the native messaging manifest. Chrome rejects wildcards in allowed_origins, so it names
// the Arclike extension exactly. A relative path is relative to the manifest, so the manifest
// needs no escaping and works under any user name.
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    SaveStringToFile(ExpandConstant('{app}\{#HostName}.json'),
      '{' + #13#10 +
      '  "name": "{#HostName}",' + #13#10 +
      '  "description": "Arclike native helper",' + #13#10 +
      '  "path": "{#MyAppExeName}",' + #13#10 +
      '  "type": "stdio",' + #13#10 +
      '  "allowed_origins": ["chrome-extension://{#ExtensionId}/"]' + #13#10 +
      '}' + #13#10, False);
end;
