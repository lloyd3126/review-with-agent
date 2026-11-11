import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, os.environ.get('LESSON_PYTHONPATH', str(Path(__file__).resolve().parents[4] / '.runtime/python-libs')))
from pypdf import PdfReader


def inspect(path):
    file = Path(path)
    if not file.is_file() or file.stat().st_size == 0:
        raise ValueError('PDF 檔案為空或不存在')
    try:
        reader = PdfReader(str(file), strict=True)
        if reader.is_encrypted:
            raise ValueError('不支援加密 PDF，請先解除密碼保護後重新匯出')
        pages = []
        warnings = []
        for number, page in enumerate(reader.pages, 1):
            box = page.cropbox
            width = float(box.width)
            height = float(box.height)
            if width <= 0 or height <= 0:
                raise ValueError(f'第 {number} 頁尺寸無效')
            rotation = int(page.get('/Rotate', 0) or 0) % 360
            try:
                text = page.extract_text() or ''
            except Exception as error:
                text = ''
                warnings.append(f'第 {number} 頁文字抽取失敗，仍保留頁面：{error}')
            display_width = height if rotation in (90, 270) else width
            display_height = width if rotation in (90, 270) else height
            pages.append({
                'page': number,
                'width': width,
                'height': height,
                'displayWidth': display_width,
                'displayHeight': display_height,
                'rotation': rotation,
                'text': text,
            })
    except ValueError:
        raise
    except Exception as error:
        raise ValueError(f'無法讀取 PDF：{error}') from error
    if not pages:
        raise ValueError('PDF 沒有任何頁面')
    return {
        'path': str(file.resolve()),
        'format': 'pdf',
        'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
        'size': file.stat().st_size,
        'pageCount': len(pages),
        'pages': pages,
        'warnings': warnings,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['inspect'])
    parser.add_argument('input')
    args = parser.parse_args()
    try:
        print(json.dumps(inspect(args.input), ensure_ascii=False, indent=2))
    except Exception as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
