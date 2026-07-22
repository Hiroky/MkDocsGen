"""デモ用の小さな greeter モジュール。

単一モジュール指定や `members` 絞り込みの例に使います。
"""


class Greeter:
  """ユーザーへの挨拶を組み立てる。

  Args:
      name: 表示名。
  """

  def __init__(self, name: str) -> None:
    """Greeter を初期化する。

    Args:
        name: 表示名。
    """
    self._name = name

  def greet(self) -> str:
    """挨拶文字列を返す。

    Returns:
        Hello 付きの文字列。
    """
    return f"Hello, {self._name}"


def shout(text: str) -> str:
  """文字列を大文字にする。

  Args:
      text: 入力文字列。

  Returns:
      大文字化した文字列。
  """
  return text.upper()
