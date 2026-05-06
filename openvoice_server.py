from __future__ import annotations

import json
import os
import shutil
import sys
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
REFERENCE_DIR = DATA_DIR / "references"
PROFILE_DIR = DATA_DIR / "voice_profile"
OUTPUT_DIR = ROOT / "outputs"
CONFIG_DIR = DATA_DIR / "config"
VENDOR_OPENVOICE = ROOT / "vendor" / "OpenVoice"
CHECKPOINTS_V2 = VENDOR_OPENVOICE / "checkpoints_v2"

for directory in (REFERENCE_DIR, PROFILE_DIR, OUTPUT_DIR, CONFIG_DIR):
    directory.mkdir(parents=True, exist_ok=True)

if VENDOR_OPENVOICE.exists():
    sys.path.insert(0, str(VENDOR_OPENVOICE))

_converter = None
_device = None
_apikey_path: Path | None = None


def json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def openvoice_ready() -> bool:
    converter_files = [
        CHECKPOINTS_V2 / "converter" / "config.json",
        CHECKPOINTS_V2 / "converter" / "checkpoint.pth",
    ]
    return VENDOR_OPENVOICE.exists() and all(path.exists() for path in converter_files)


def load_converter():
    global _converter, _device
    if _converter is not None:
        return _converter, _device
    if not openvoice_ready():
        raise RuntimeError("OpenVoice V2 repo/checkpoints が未設定です。scripts/Setup-OpenVoice.ps1 を実行してください。")

    import torch
    from openvoice.api import ToneColorConverter

    _device = "cuda:0" if torch.cuda.is_available() else "cpu"
    converter_dir = CHECKPOINTS_V2 / "converter"
    _converter = ToneColorConverter(str(converter_dir / "config.json"), device=_device)
    _converter.load_ckpt(str(converter_dir / "checkpoint.pth"))
    return _converter, _device


def extract_voice_profile(reference_path: Path) -> Path:
    import torch
    from pydub import AudioSegment
    from openvoice import se_extractor

    try:
        import imageio_ffmpeg
        AudioSegment.converter = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass

    converter, _device = load_converter()
    target_se, _audio_name = se_extractor.get_se(str(reference_path), converter, target_dir=str(DATA_DIR / "processed"), vad=True)
    output_path = PROFILE_DIR / "target_se.pth"
    torch.save(target_se, output_path)
    return output_path


def source_speaker_embedding(language: str, speaker_key: str | None = None):
    import torch
    from melo.api import TTS

    _converter, device = load_converter()
    model = TTS(language=language, device=device)
    speaker_ids = model.hps.data.spk2id
    selected_key = speaker_key if speaker_key in speaker_ids else next(iter(speaker_ids.keys()))
    speaker_id = speaker_ids[selected_key]
    normalized_key = selected_key.lower().replace("_", "-")
    source_se_path = CHECKPOINTS_V2 / "base_speakers" / "ses" / f"{normalized_key}.pth"
    if not source_se_path.exists():
        candidates = sorted((CHECKPOINTS_V2 / "base_speakers" / "ses").glob("*.pth"))
        if not candidates:
            raise RuntimeError("base speaker の tone color embedding が見つかりません。")
        source_se_path = candidates[0]
    return model, speaker_id, torch.load(str(source_se_path), map_location=device)


def generate_cloned_voice(text: str, language: str = "JP", speed: float = 1.0) -> Path:
    import torch

    target_se_path = PROFILE_DIR / "target_se.pth"
    if not target_se_path.exists():
        raise RuntimeError("先に参照音声を登録してください。")

    converter, device = load_converter()
    model, speaker_id, source_se = source_speaker_embedding(language)
    target_se = torch.load(str(target_se_path), map_location=device)

    timestamp = int(time.time() * 1000)
    source_path = OUTPUT_DIR / f"source_{timestamp}.wav"
    output_path = OUTPUT_DIR / f"openvoice_{timestamp}.wav"

    model.tts_to_file(text, speaker_id, str(source_path), speed=speed)
    converter.convert(
        audio_src_path=str(source_path),
        src_se=source_se,
        tgt_se=target_se,
        output_path=str(output_path),
        message="@LocalVoiceStudio",
    )
    return output_path


def generate_base_voice(text: str, language: str = "JP", speed: float = 1.0) -> Path:
    _converter, device = load_converter()
    from melo.api import TTS

    model = TTS(language=language, device=device)
    speaker_ids = model.hps.data.spk2id
    speaker_id = speaker_ids[next(iter(speaker_ids.keys()))]
    timestamp = int(time.time() * 1000)
    output_path = OUTPUT_DIR / f"base_{language.lower()}_{timestamp}.wav"
    model.tts_to_file(text, speaker_id, str(output_path), speed=speed)
    return output_path


def language_for_base_voice(profile: str, selected_language: str) -> str:
    profile_map = {
        "base-jp": "JP",
        "base-en": "EN_NEWEST",
        "base-zh": "ZH",
        "base-kr": "KR",
    }
    return profile_map.get(profile, selected_language)


def _read_body(handler) -> bytes:
    length = int(handler.headers.get("Content-Length", "0"))
    return handler.rfile.read(length)


def _parse_multipart(handler):
    """Parse multipart form data without using the deprecated cgi module."""
    content_type = handler.headers.get("Content-Type", "")
    if "boundary=" not in content_type:
        return {}
    boundary = content_type.split("boundary=")[-1].strip()
    body = _read_body(handler)
    parts = body.split(f"--{boundary}".encode())
    result = {}
    for part in parts:
        if b"Content-Disposition" not in part:
            continue
        header_end = part.find(b"\r\n\r\n")
        if header_end < 0:
            continue
        header_section = part[:header_end].decode("utf-8", errors="replace")
        data = part[header_end + 4:]
        if data.endswith(b"\r\n"):
            data = data[:-2]
        name = None
        filename = None
        for line in header_section.split("\r\n"):
            if "Content-Disposition" in line:
                for token in line.split(";"):
                    token = token.strip()
                    if token.startswith("name="):
                        name = token.split("=", 1)[1].strip('"')
                    if token.startswith("filename="):
                        filename = token.split("=", 1)[1].strip('"')
        if name:
            result[name] = {"data": data, "filename": filename}
    return result


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, status: int, payload: dict) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json(200, {
                "ok": True,
                "openvoice_ready": openvoice_ready(),
                "profile_ready": any(PROFILE_DIR.glob("*.pth")),
            })
            return
        if parsed.path == "/api/history":
            self.handle_history()
            return
        if parsed.path == "/api/profiles":
            self.handle_list_profiles()
            return
        if parsed.path == "/api/config/apikey":
            self.handle_get_apikey()
            return
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/clone":
                self.handle_clone()
                return
            if parsed.path == "/api/generate":
                self.handle_generate()
                return
            if parsed.path == "/api/config/apikey":
                self.handle_save_apikey()
                return
            self.send_json(404, {"error": "not found"})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path.startswith("/api/history/"):
                filename = unquote(parsed.path.replace("/api/history/", ""))
                self.handle_delete_file(OUTPUT_DIR / filename)
                return
            if parsed.path.startswith("/api/profiles/"):
                name = unquote(parsed.path.replace("/api/profiles/", ""))
                self.handle_delete_file(PROFILE_DIR / f"{name}.pth")
                return
            if parsed.path == "/api/config/apikey":
                self.handle_delete_apikey()
                return
            self.send_json(404, {"error": "not found"})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})

    def handle_delete_file(self, target_path: Path) -> None:
        if target_path.exists() and target_path.is_file():
            target_path.unlink()
            self.send_json(200, {"message": "削除しました"})
        else:
            self.send_json(404, {"error": "ファイルが見つかりません"})

    def handle_clone(self) -> None:
        parts = _parse_multipart(self)
        voice_part = parts.get("voice")
        profile_name = parts.get("profileName", {"data": b"default"})["data"].decode("utf-8").strip() or "default"
        
        if voice_part is None or not voice_part["data"]:
            self.send_json(400, {"error": "voice ファイルがありません。"})
            return
            
        suffix = Path(voice_part["filename"] or "reference.wav").suffix or ".wav"
        reference_path = REFERENCE_DIR / f"reference_{int(time.time())}{suffix}"
        reference_path.write_bytes(voice_part["data"])

        import torch
        from openvoice import se_extractor
        converter, _device = load_converter()
        target_se, _audio_name = se_extractor.get_se(str(reference_path), converter, target_dir=str(DATA_DIR / "processed"), vad=True)
        profile_path = PROFILE_DIR / f"{profile_name}.pth"
        torch.save(target_se, profile_path)

        self.send_json(200, {
            "message": f"プロファイル '{profile_name}' を登録しました",
            "reference": reference_path.name,
            "profile": profile_path.name,
        })

    def handle_list_profiles(self) -> None:
        profiles = [p.stem for p in PROFILE_DIR.glob("*.pth")]
        self.send_json(200, {"profiles": sorted(profiles)})

    def handle_generate(self) -> None:
        payload = json.loads(_read_body(self).decode("utf-8"))
        text = str(payload.get("text", "")).strip()
        language = str(payload.get("language", "JP")).strip() or "JP"
        voice_profile = str(payload.get("voiceProfile", "clone")).strip() or "clone"
        speed = float(payload.get("speed", 1.0))
        
        if not text:
            self.send_json(400, {"error": "text が空です。"})
            return

        if voice_profile.startswith("profile:"):
            name = voice_profile.replace("profile:", "")
            profile_path = PROFILE_DIR / f"{name}.pth"
            if not profile_path.exists():
                self.send_json(400, {"error": f"プロファイル '{name}' が見つかりません。"})
                return
            
            import torch
            converter, device = load_converter()
            model, speaker_id, source_se = source_speaker_embedding(language)
            target_se = torch.load(str(profile_path), map_location=device)
            
            timestamp = int(time.time() * 1000)
            source_path = OUTPUT_DIR / f"source_{timestamp}.wav"
            output_path = OUTPUT_DIR / f"openvoice_{timestamp}.wav"
            
            model.tts_to_file(text, speaker_id, str(source_path), speed=speed)
            converter.convert(audio_src_path=str(source_path), src_se=source_se, tgt_se=target_se, output_path=str(output_path), message="@LocalVoiceStudio")
        elif voice_profile == "clone":
            output_path = generate_cloned_voice(text=text, language=language, speed=speed)
        else:
            output_path = generate_base_voice(
                text=text,
                language=language_for_base_voice(voice_profile, language),
                speed=speed,
            )
        audio_url = f"/outputs/{unquote(output_path.name)}"
        self.send_json(200, {"audio_url": audio_url, "file_name": output_path.name})

    def handle_history(self) -> None:
        files = []
        for f in sorted(OUTPUT_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if f.is_file() and f.suffix.lower() in (".wav", ".mp3", ".ogg", ".webm"):
                if f.name.startswith("source_"):
                    continue
                files.append({
                    "name": f.name,
                    "url": f"/outputs/{f.name}",
                    "size": f.stat().st_size,
                    "modified": int(f.stat().st_mtime),
                })
        self.send_json(200, {"files": files})

    def handle_get_apikey(self) -> None:
        global _apikey_path
        if _apikey_path and _apikey_path.exists():
            key = _apikey_path.read_text(encoding="utf-8").strip()
            self.send_json(200, {"key": key})
        else:
            self.send_json(200, {"key": ""})

    def handle_save_apikey(self) -> None:
        global _apikey_path
        payload = json.loads(_read_body(self).decode("utf-8"))
        key = str(payload.get("key", "")).strip()
        path_str = str(payload.get("path", "")).strip()
        if not key:
            self.send_json(400, {"error": "key が空です。"})
            return
        if path_str:
            _apikey_path = Path(path_str)
            _apikey_path.parent.mkdir(parents=True, exist_ok=True)
            _apikey_path.write_text(key, encoding="utf-8")
        else:
            default_path = CONFIG_DIR / "gemini.key"
            default_path.write_text(key, encoding="utf-8")
            _apikey_path = default_path
        self.send_json(200, {"message": "APIキーを保存しました", "path": str(_apikey_path)})

    def handle_delete_apikey(self) -> None:
        global _apikey_path
        if _apikey_path and _apikey_path.exists():
            _apikey_path.unlink(missing_ok=True)
        _apikey_path = None
        self.send_json(200, {"message": "APIキーを削除しました"})


def main() -> None:
    port = int(os.environ.get("PORT", "5180"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Voice studio server: http://127.0.0.1:{port}/")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
