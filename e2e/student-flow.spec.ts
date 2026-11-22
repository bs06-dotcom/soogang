import { expect, test } from "@playwright/test";

const courses = [
  {
    id: 21, category: "주제선택", name: "테크놀로지야 놀자", capacity: 20,
    startsAt: "2020-01-01T00:00:00.000Z", endsAt: "2099-12-31T14:59:59.000Z",
  },
  {
    id: 22, category: "주제선택", name: "드로잉의 모든 것", capacity: 10,
    startsAt: "2099-01-01T00:00:00.000Z", endsAt: "2099-12-31T14:59:59.000Z",
  },
  {
    id: 23, category: "예술체육", name: "배구", capacity: 15,
    startsAt: "2020-01-01T00:00:00.000Z", endsAt: "2099-12-31T14:59:59.000Z",
  },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/student", async (route) => {
    const request = route.request();
    const { action } = request.postDataJSON() as { action: string };
    const result = action === "catalog" ? { courses }
      : action === "verify_course" ? { proof: "short-lived-proof" }
        : action === "register" ? { courseName: "테크놀로지야 놀자" }
          : action === "mine" ? { registrations: [] }
            : action === "status" ? { categories: [{ name: "주제선택", courses: [courses[0]] }] }
              : action === "cancel" ? { ok: true }
                : { error: "요청 정보를 확인해주세요." };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
});

test("course code is cleared before student identity and application completes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /주제선택/ }).click();
  await page.getByRole("button", { name: "수강 신청하기" }).first().click();
  await page.getByLabel("과목 코드").fill("course-secret");
  await page.getByRole("button", { name: "과목 코드 확인" }).click();

  const studentNumber = page.getByLabel("학번");
  await expect(studentNumber).toHaveValue("");
  await expect(page.getByLabel("학생 전용 코드")).toHaveValue("");
  await studentNumber.fill("00123");
  await page.getByLabel("이름").fill("가상학생");
  await page.getByLabel("학생 전용 코드").fill("student-secret");
  await page.getByRole("button", { name: "수강 신청 완료" }).click();
  await expect(page.getByText("테크놀로지야 놀자 신청이 완료되었습니다.")).toBeVisible();
});

test("future course warning and category-first status navigation are visible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /주제선택/ }).click();
  await page.getByRole("button", { name: "신청 예정" }).click();
  await expect(page.getByText("아직 수강신청 시간이 아닙니다", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "닫기" }).click();
  await page.getByRole("button", { name: /현재 수강현황 조회하기/ }).click();
  await page.getByLabel("학번").fill("00123");
  await page.getByLabel("이름").fill("가상학생");
  await page.getByLabel("학생 전용 코드").fill("student-secret");
  await page.getByRole("button", { name: "수강현황 조회", exact: true }).click();
  await expect(page.getByRole("button", { name: /주제선택/ }).last()).toBeVisible();
  await page.getByRole("button", { name: /주제선택/ }).last().click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "테크놀로지야 놀자" })).toBeVisible();
});

test("administrator route presents a separate email and password login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "관리자 로그인" })).toBeVisible();
  await expect(page.getByLabel("이메일")).toHaveValue("");
  await expect(page.getByLabel("비밀번호")).toBeVisible();
});
