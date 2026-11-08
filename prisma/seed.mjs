import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEMO_PASSWORD = "demo1234";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/** 清空并重建演示数据（幂等，可反复执行） */
export async function seed() {
  console.log("清理旧数据…");
  await prisma.submission.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.course.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.class.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = hashPassword(DEMO_PASSWORD);

  const teacher = await prisma.user.create({
    data: {
      name: "王老师",
      email: "teacher@demo.edu",
      passwordHash,
      role: "TEACHER",
      avatarColor: "#0D9488",
    },
  });

  const [liming, xiaohong, xiaojun, xiaomei] = await Promise.all([
    prisma.user.create({
      data: { name: "李小明", email: "student@demo.edu", passwordHash, role: "STUDENT", avatarColor: "#D97706" },
    }),
    prisma.user.create({
      data: { name: "张小红", email: "xiaohong@demo.edu", passwordHash, role: "STUDENT", avatarColor: "#2563EB" },
    }),
    prisma.user.create({
      data: { name: "陈小军", email: "xiaojun@demo.edu", passwordHash, role: "STUDENT", avatarColor: "#7C3AED" },
    }),
    prisma.user.create({
      data: { name: "刘小美", email: "xiaomei@demo.edu", passwordHash, role: "STUDENT", avatarColor: "#DB2777" },
    }),
  ]);

  const classA = await prisma.class.create({
    data: { name: "初二（3）班", grade: "初二", joinCode: "MATH01", teacherId: teacher.id },
  });

  const classB = await prisma.class.create({
    data: { name: "初二数学兴趣小组", grade: "初二", joinCode: "MATH02", teacherId: teacher.id },
  });

  await prisma.enrollment.createMany({
    data: [
      { classId: classA.id, studentId: liming.id },
      { classId: classA.id, studentId: xiaohong.id },
      { classId: classA.id, studentId: xiaojun.id },
      { classId: classA.id, studentId: xiaomei.id },
      { classId: classB.id, studentId: liming.id },
      { classId: classB.id, studentId: xiaohong.id },
    ],
  });

  const math = await prisma.course.create({
    data: {
      classId: classA.id,
      title: "数学",
      description: "人教版八年级上册：有理数、整式与几何证明基础",
      color: "#0D9488",
    },
  });

  const physics = await prisma.course.create({
    data: {
      classId: classA.id,
      title: "物理",
      description: "八年级物理：声、光、电基础与实验",
      color: "#D97706",
    },
  });

  await prisma.course.create({
    data: {
      classId: classB.id,
      title: "数学思维拓展",
      description: "每周一次的兴趣小组：趣味数论与几何变换",
      color: "#2563EB",
    },
  });

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const assignment1 = await prisma.assignment.create({
    data: {
      courseId: math.id,
      createdById: teacher.id,
      title: "第一章 有理数 单元练习",
      description:
        "完成练习册 P12–P18：有理数的加减乘除与混合运算。要求写出关键步骤，拍照或直接录入过程。",
      points: 100,
      dueAt: new Date(now + 3 * day),
    },
  });

  const assignment2 = await prisma.assignment.create({
    data: {
      courseId: math.id,
      createdById: teacher.id,
      title: "几何证明入门：全等三角形",
      description: "完成两道证明题，说明所用判定定理（SSS / SAS / ASA / AAS）。",
      points: 100,
      dueAt: new Date(now - 2 * day),
    },
  });

  const assignment3 = await prisma.assignment.create({
    data: {
      courseId: physics.id,
      createdById: teacher.id,
      title: "实验报告：测量小灯泡的电阻",
      description:
        "按实验报告格式记录：实验目的、器材、电路图、数据表格、误差分析。可上传文字版报告。",
      points: 50,
      dueAt: new Date(now + 5 * day),
    },
  });

  await prisma.submission.createMany({
    data: [
      {
        assignmentId: assignment1.id,
        studentId: liming.id,
        content:
          "练习册 P12–P18 已完成。\n1) (-3) + 5 - (-2) = 4；\n2) (-2)^3 × (-3) = 24；\n3) 混合运算部分：先乘除后加减，注意符号。\n易错点：负负得正时括号处理。",
        score: 92,
        feedback: "步骤完整，符号处理正确。第 15 题可再检查一遍计算顺序。",
        gradedAt: new Date(now - 1 * day),
      },
      {
        assignmentId: assignment1.id,
        studentId: xiaohong.id,
        content: "已提交：P12–P18 全部完成，最后一页练习题附了解题过程。",
      },
      {
        assignmentId: assignment2.id,
        studentId: liming.id,
        content: "1) 用 SAS 证明 △ABC ≌ △DEF；2) 用 ASA 证明角平分线上的点到两边距离相等。",
        score: 85,
        feedback: "第一题思路清晰；第二题记得先作垂线再说明。",
        gradedAt: new Date(now - 1 * day),
      },
      {
        assignmentId: assignment2.id,
        studentId: xiaohong.id,
        content: "两道证明题已完成，写在作业本上并拍照整理。",
      },
    ],
  });

  await prisma.announcement.createMany({
    data: [
      {
        classId: classA.id,
        title: "期中考试安排",
        content: "期中考试定于下周三上午 8:30–10:10 在教室进行，范围：有理数、整式、全等三角形。",
      },
      {
        classId: classA.id,
        title: "实验课提醒",
        content: "本周五物理实验课请提前 5 分钟到实验室，穿运动鞋，勿携带食品。",
      },
      {
        classId: classB.id,
        title: "兴趣小组活动",
        content: "本周六上午 9:00 在图书馆三楼开展数学思维拓展活动，欢迎带一道有趣的题来分享。",
      },
    ],
  });

  console.log("种子数据完成：");
  console.log(`  教师 teacher@demo.edu / ${DEMO_PASSWORD}`);
  console.log(`  学生 student@demo.edu / ${DEMO_PASSWORD}（李小明）`);
  console.log("  其他学生 xiaohong@demo.edu / xiaojun@demo.edu / xiaomei@demo.edu，密码同上");
  console.log(`  班级邀请码：${classA.joinCode}（初二（3）班）、${classB.joinCode}（兴趣小组）`);
}

async function main() {
  try {
    await seed();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

// 直接 `node prisma/seed.mjs` 时执行；被 ensure-seed.mjs import 时只导出 seed
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
