"""文字列ユーティリティ。

モジュール直下の関数と Google スタイル docstring の解析例です。
"""


def shout(text: str) -> str:
    """文字列を大文字にする。

    Args:
        text: 入力文字列。

    Returns:
        大文字化した文字列。

    Raises:
        ValueError: 空文字のとき。
    """
    if not text:
        raise ValueError("empty")
    return text.upper()


def join_labels(*labels: str, sep: str = ", ") -> str:
    """ラベルを結合する。

    Args:
        labels: 結合するラベル群。
        sep: 区切り文字。

    Returns:
        結合後の文字列。

    Yields:
        ここでは使いませんが、Yields セクションの表示例です。
    """
    return sep.join(labels)


def _hidden() -> None:
    """非公開関数（既定では非表示）。"""
    pass
