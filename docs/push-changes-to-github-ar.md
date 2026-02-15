# أسهل طريقة لرفع التعديلات على GitHub

لو التعديلات موجودة عندك محليًا، استخدم سكربت واحد فقط:

```bash
bash scripts/push-to-github.sh https://github.com/KareemX99/OctoMedia-v2.git work
```

> غيّر `work` إلى اسم الفرع عندك لو مختلف.

## ماذا يفعل السكربت؟
1. يضيف/يحدّث `origin` تلقائيًا.
2. يعمل push للفرع الحالي (أو الفرع الذي تحدده).
3. يربط الفرع المحلي بالفرع البعيد عبر `-u`.

## لو عندك Username/Password لا تعمل
استخدم **GitHub Personal Access Token** بدل كلمة السر عند طلب credentials.

## بديل يدوي (بدون سكربت)
```bash
git remote add origin https://github.com/KareemX99/OctoMedia-v2.git 2>/dev/null || git remote set-url origin https://github.com/KareemX99/OctoMedia-v2.git
git push -u origin work
```
