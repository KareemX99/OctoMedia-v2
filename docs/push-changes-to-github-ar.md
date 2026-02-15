# أسهل طريقة لرفع التعديلات على GitHub

## مهم جدًا قبل أي push
1. افتح Terminal داخل فولدر المشروع.
2. اعرف اسم الفرع الحالي:

```bash
git branch --show-current
```

> لو ظهر اسم غير `work` استخدم الاسم الذي ظهر لك في أوامر `push`.

---

## لو أنت على Windows CMD / PowerShell (بدون bash)
استخدم سكربت PowerShell الجاهز:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/push-to-github.ps1 "https://github.com/KareemX99/OctoMedia-v2.git" "work"
```

---

## لو عندك Git Bash
تقدر تستخدم سكربت bash:

```bash
bash scripts/push-to-github.sh https://github.com/KareemX99/OctoMedia-v2.git work
```

---

## لو ظهر لك: `src refspec work does not match any`
هذا يعني غالبًا أحد سببين:
1. اسم الفرع ليس `work` (استخدم نتيجة `git branch --show-current`).
2. لا يوجد commit محلي بعد:

```bash
git add .
git commit -m "your message"
```

ثم أعد أمر الـ push.

---

## بديل يدوي لـ Windows (بدون `2>/dev/null`)
نفّذ سطرين منفصلين:

```bash
git remote add origin https://github.com/KareemX99/OctoMedia-v2.git
git remote set-url origin https://github.com/KareemX99/OctoMedia-v2.git
```

ثم:

```bash
git push -u origin <branch-name>
```

## لو طلب GitHub تسجيل دخول
استخدم **GitHub Personal Access Token** بدل كلمة المرور.
