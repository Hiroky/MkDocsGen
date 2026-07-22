"""挨拶を組み立てるモジュール。

クラス・プロパティ・classmethod / staticmethod の解析例を含みます。
"""

from typing import Optional


class Greeter:
    """ユーザーへの挨拶を組み立てる。

    Note:
        メッセージは短く保つ。
    """

    count: int

    def __init__(self, name: str) -> None:
        """Greeter を初期化する。

        Args:
            name: 表示名。
        """
        self._name = name
        self.count = 0

    @property
    def name(self) -> str:
        """表示名を返す。"""
        return self._name

    @classmethod
    def from_default(cls) -> "Greeter":
        """デフォルト名で Greeter を作る。"""
        return cls("world")

    @staticmethod
    def shout(text: str) -> str:
        """文字列を大文字にする。

        Args:
            text (str): 入力文字列。

        Returns:
            大文字化した文字列。

        Raises:
            ValueError: 空文字のとき。

        Examples:
            >>> Greeter.shout("hi")
            'HI'

        Warning:
            出力が大きくなることがあります。
        """
        if not text:
            raise ValueError("empty")
        return text.upper()

    def greet(self, times: int = 1) -> str:
        """挨拶文字列を返す。

        Args:
            times: 繰り返し回数。

        Returns:
            Hello 付きの文字列。
        """
        self.count += 1
        return ("Hello, " + self._name + "! ") * times

    def _secret(self) -> None:
        """非公開メソッド（show-private が false のときは非表示）。"""
        return None


def optional_label(value: Optional[str] = None) -> str:
    """オプション引数付きの補助関数。

    Args:
        value: 任意のラベル。省略時は空文字。

    Returns:
        正規化したラベル。
    """
    return value or ""
