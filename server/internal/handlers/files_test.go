package handlers

import (
	"errors"
	"strings"
	"testing"
)

func TestCleanOriginalName(t *testing.T) {
	cases := map[string]string{
		"":                                 "未命名文件",
		"   ":                              "未命名文件",
		".":                                "未命名文件",
		"...":                              "未命名文件",
		"report.txt":                       "report.txt",
		"a/b/c.png":                        "c.png",
		`C:\Users\student\submission.docx`: "submission.docx",
		"../../evil.txt":                   "evil.txt",
		"..\\..\\evil.txt":                 "evil.txt",
		"...hidden...":                     "hidden",
		"a\x00b.txt":                       "ab.txt",
		"line\nbreak.txt":                  "linebreak.txt",
		"中文 文件.txt":                        "中文 文件.txt",
	}
	for input, expected := range cases {
		if actual := cleanOriginalName(input); actual != expected {
			t.Errorf("cleanOriginalName(%q) = %q，期望 %q", input, actual, expected)
		}
	}
}

func TestCleanOriginalNameTruncates(t *testing.T) {
	longName := strings.Repeat("a", 300) + ".txt"
	cleaned := cleanOriginalName(longName)
	if len([]rune(cleaned)) != 180 {
		t.Errorf("过长文件名应截断到 180 个字符，实际 %d", len([]rune(cleaned)))
	}
	if !strings.HasSuffix(cleaned, "a") {
		t.Errorf("截断后的文件名应以原字符结尾，实际 %q", cleaned[len(cleaned)-5:])
	}
}

func TestSafeExtension(t *testing.T) {
	cases := map[string]string{
		"report.txt":       ".txt",
		"REPORT.TXT":       ".txt",
		"archive.tar.gz":   ".gz",
		"file":             "",
		"file.":            "",
		"file.toolongext":  ".toolongext",
		"file.verylongext": "",
		"file.<script>":    "",
		"file.中文":          "",
		"file.7z":          ".7z",
	}
	for input, expected := range cases {
		if actual := safeExtension(input); actual != expected {
			t.Errorf("safeExtension(%q) = %q，期望 %q", input, actual, expected)
		}
	}
}

func TestIsUniqueViolation(t *testing.T) {
	if isUniqueViolation(nil) {
		t.Error("nil 错误不应判断为唯一约束冲突")
	}
	if !isUniqueViolation(errors.New("constraint failed: UNIQUE constraint failed: users.login_id")) {
		t.Error("UNIQUE constraint failed 应判断为唯一约束冲突")
	}
	if isUniqueViolation(errors.New("disk I/O error")) {
		t.Error("普通错误不应判断为唯一约束冲突")
	}
}

func TestNormalizeLoginID(t *testing.T) {
	cases := map[string]string{
		"  Teacher@Demo.Edu ": "teacher@demo.edu",
		"S001":                "S001",
		" 13800138000 ":       "13800138000",
		"":                    "",
	}
	for input, expected := range cases {
		if actual := normalizeLoginID(input); actual != expected {
			t.Errorf("normalizeLoginID(%q) = %q，期望 %q", input, actual, expected)
		}
	}
}

func TestLoginIDValidation(t *testing.T) {
	validEmails := []string{"teacher@demo.edu", "a.b@school.cn"}
	for _, email := range validEmails {
		if !validEmail(email) {
			t.Errorf("validEmail(%q) 应为 true", email)
		}
	}
	invalidEmails := []string{"", "abc", "@demo.edu", "a@", "a@b", "a b@demo.edu", "a@@demo.edu"}
	for _, email := range invalidEmails {
		if validEmail(email) {
			t.Errorf("validEmail(%q) 应为 false", email)
		}
	}
	validPhones := []string{"13800138000", "19912345678"}
	for _, phone := range validPhones {
		if !isPhoneLoginID(phone) {
			t.Errorf("isPhoneLoginID(%q) 应为 true", phone)
		}
	}
	invalidPhones := []string{"", "1380013800", "138001380001", "23800138000", "1380013800a"}
	for _, phone := range invalidPhones {
		if isPhoneLoginID(phone) {
			t.Errorf("isPhoneLoginID(%q) 应为 false", phone)
		}
	}
	if !isAllDigits("1234567890") || isAllDigits("123a") {
		t.Error("isAllDigits 判断不正确")
	}
}

func TestValidTopicStatus(t *testing.T) {
	if !validTopicStatus("ACTIVE") || !validTopicStatus("CLOSED") {
		t.Error("ACTIVE / CLOSED 应为合法状态")
	}
	for _, status := range []string{"", "OPEN", "active", "DELETED"} {
		if validTopicStatus(status) {
			t.Errorf("%q 不应是合法课题状态", status)
		}
	}
}

func TestResolveStoragePathRejectsTraversal(t *testing.T) {
	api := &API{UploadDir: t.TempDir()}
	for _, bad := range []string{"../escape.txt", "../../etc/passwd", "sub/../../escape.txt"} {
		if _, err := api.resolveStoragePath(bad); err == nil {
			t.Errorf("路径 %q 应被拒绝", bad)
		}
	}
	good, err := api.resolveStoragePath("submissions/s1/file.txt")
	if err != nil {
		t.Fatalf("正常相对路径不应报错: %v", err)
	}
	if !strings.Contains(good, "file.txt") {
		t.Errorf("解析结果异常: %s", good)
	}
}
