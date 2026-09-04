@echo off
title Tokage Search - Deploy

echo ========================================
echo       Tokage Search Deploy
echo ========================================
echo.

cd /d "C:\Users\aoto\Desktop\my-proxy"

echo [1/3] Git add...
git add .

echo.
echo [2/3] Git commit...
git commit -m "update Tokage Search"

echo.
echo [3/3] Git push...
git push -f origin main

echo.
echo ========================================
echo          Deploy finished
echo ========================================
echo.
pause