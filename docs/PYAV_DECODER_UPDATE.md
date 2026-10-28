# Existing-install decoder repair — worker 0.12.1

This repair targets `open() got an unexpected keyword argument 'metadata_errors'`.
It does not require uninstalling the extension, deleting its data or downloading
speech models again. Extension 0.12.5 and worker 0.12.1 are separate components.

1. Stop the current analysis in the extension.
2. Extract this update into the **existing project folder**, replacing the
   matching `server/batch_transcribe.py` and `server/requirements.txt` files.
   Do not load the extension from a different folder or delete .venv/.runtime.
3. Refresh the media page and start analysis again. Batch workers start from the
   updated Python file; diagnostics should report worker **0.12.1**.

The worker now opens direct and PNG-wrapped HLS media with either the legacy
PyAV metadata API or the PyAV 19 API. No dependency change is required merely to
exercise this compatibility repair on those two paths.

Fresh installations pin the tested `av==18.0.0`, since faster-whisper 1.2.1's
file decoder also uses the removed keyword. If restoring an existing install
to that tested dependency is needed, close the local recognizer first, then
run this **from the existing project folder**:

```powershell
.\.venv\Scripts\python.exe -m pip install "av==18.0.0"
```

Restart the recognizer with CHECK-SETUP.cmd afterward. Do not update system-wide
Python packages. Existing transcripts, vocabulary and configuration are retained.

Local compatibility fixtures and full regression passed. The friend's actual
PyAV version, media site, full decoding and transcription remain unverified;
another site/network/codec failure may become visible after this error is fixed.
