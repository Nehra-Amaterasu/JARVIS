# Print one Word file to PDF with the Word installed on this PC. Called only by ww_pyq/word.py.
#
#   powershell -NoProfile -NonInteractive -File word_to_pdf.ps1 -Source <file> -Target <file.pdf>
#
# First line of output: "pid <n>", the process id of the Word this script started, so the caller can end
# exactly that Word if it hangs on a dialog. Last line: "ok" or "fail <reason>". Exit code 0 only on ok.
# The script starts its own hidden Word; a Word window the student has open is another process and is
# not touched. Macros are forced off, the file is opened read only, and nothing is added to recent files.
param([Parameter(Mandatory = $true)][string]$Source, [Parameter(Mandatory = $true)][string]$Target)
$ErrorActionPreference = 'Stop'
$word = $null
$doc = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0            # wdAlertsNone: a question from Word would wait for ever in a hidden window
    $word.AutomationSecurity = 3       # msoAutomationSecurityForceDisable: no macro of the file runs
    Add-Type -Namespace WwWord -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);'
    $wordPid = 0
    try { [void][WwWord.Native]::GetWindowThreadProcessId([IntPtr]$word.Hwnd, [ref]$wordPid) } catch { $wordPid = 0 }
    "pid $wordPid"
    # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument, PasswordTemplate, Revert)
    # A wrong password is given on purpose: a locked file then fails at once instead of asking in a hidden window.
    $doc = $word.Documents.Open($Source, $false, $true, $false, 'x', 'x', $true)
    $doc.ExportAsFixedFormat($Target, 17)     # wdExportFormatPDF
    "ok"
    $code = 0
}
catch {
    $m = $_.Exception.Message -replace '\s+', ' '
    "fail " + $m.Substring(0, [Math]::Min(200, $m.Length))
    $code = 1
}
finally {
    if ($doc) { try { $doc.Close(0) } catch {} }      # wdDoNotSaveChanges
    if ($word) { try { $word.Quit(0) } catch {} }
}
exit $code
