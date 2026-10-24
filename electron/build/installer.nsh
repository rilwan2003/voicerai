; VoicerAI: teach Windows about the sign-in hand-off link.
;
; The website finishes a sign-in by opening voicerai://auth?code=..., and the app
; receives that URL as its launch arguments. Without this key the link has no
; handler and the sign-in silently goes nowhere. The app registers the same key
; at startup, so an existing install repairs itself on the next launch.

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\voicerai" "" "URL:VoicerAI sign-in link"
  WriteRegStr SHCTX "Software\Classes\voicerai" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\voicerai\DefaultIcon" "" "$INSTDIR\VoicerAI.exe,1"
  WriteRegStr SHCTX "Software\Classes\voicerai\shell\open\command" "" '"$INSTDIR\VoicerAI.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\voicerai"
!macroend
