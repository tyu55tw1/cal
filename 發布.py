# 行事曆手機版發布：src\ → GitHub Pages（repo tyu55tw1/cal，公開；只放程式，班表回診只在手機）
#   py 發布.py beta      src → beta\（測試網址 https://tyu55tw1.github.io/cal/beta/）
#   py 發布.py app       beta → app\（正式，App 開這個），原本的 app 先存到 prev\
#   py 發布.py rollback  prev ↔ app 對調（正式版出問題，一分鐘換回上一版）
# 之後 git commit、push 就上線（Pages 約 1 分鐘更新）。
import os, shutil, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
D = lambda n: os.path.join(ROOT, n)


def copy(a, b):
    shutil.rmtree(D(b), ignore_errors=True)
    shutil.copytree(D(a), D(b))


cmd = (sys.argv[1:] or [""])[0]
if cmd == "beta":
    copy("src", "beta")
elif cmd == "app":
    if not os.path.isdir(D("beta")):
        sys.exit("先發 beta、測過再發 app")
    if os.path.isdir(D("app")):
        copy("app", "prev")
    copy("beta", "app")
elif cmd == "rollback":
    if not os.path.isdir(D("prev")):
        sys.exit("沒有上一版")
    shutil.move(D("app"), D("_tmp"))
    shutil.move(D("prev"), D("app"))
    shutil.move(D("_tmp"), D("prev"))
else:
    sys.exit(__doc__ or "用法：py 發布.py beta|app|rollback")
print("好了：", cmd, "→ 記得 git commit、git push")
