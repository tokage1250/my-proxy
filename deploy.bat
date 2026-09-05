@echo off
chcp 65001 >nul
title Tokage Search - Deploy

echo.
echo ==========================================
echo       Tokage Search Deploy
echo ==========================================
echo.

REM プロジェクトフォルダへ移動
cd /d "C:\Users\aoto\Desktop\my-proxy"

if errorlevel 1 (
    echo [ERROR] プロジェクトフォルダが見つかりません。
    pause
    exit /b 1
)

echo [1/6] 現在のフォルダ:
cd
echo.

echo [2/6] Gitの状態を確認しています...
git status
echo.

echo [3/6] GitHubの最新状態を同期(pull)しています...
git pull origin main --rebase
echo.

echo [4/6] ファイルを追加しています...
git add .
if errorlevel 1 (
    echo.
    echo [ERROR] git add に失敗しました。
    pause
    exit /b 1
)

echo.
echo [5/6] コミットしています...
git commit -m "Update Tokage Search (fix syntax and routing)"
REM コミットする変更がない場合もエラーを無視して続行
if errorlevel 1 (
    echo ※ 新しい変更がない可能性がありますが、pushを続行します。
)

echo.
echo [6/6] GitHubへpushしています...
git push origin main

if errorlevel 1 (
    echo.
    echo ==========================================
    echo [ERROR] pushに失敗しました。
    echo ==========================================
    echo 上に表示されたエラーを確認してください。
    echo.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo        DEPLOY SUCCESS
echo ==========================================
echo.
echo GitHubへの更新が完了しました。
echo RenderがGitHubと接続されていれば、
echo 数分以内に自動的にDeployが開始されます。
echo.

git log -1 --oneline

echo.
echo この画面は確認するまで閉じません。
pause