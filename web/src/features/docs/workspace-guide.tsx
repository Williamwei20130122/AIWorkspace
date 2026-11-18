/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Markdown } from '@/components/ui/markdown'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

/**
 * 配图数据。
 */
export type GuideShot = {
  /** 稳定标识，作为 React key 使用 */
  id: string
  /** 真实截图地址；为空时渲染虚线占位块 */
  src: string
  /** 图片说明：写清「这是什么页面、红框在哪、要做什么」 */
  caption: string
}

/** 章节内的一节（正文 + 若干配图），每节渲染为独立卡片 */
export type GuideSection = {
  id: string
  title: string
  /** Markdown 正文 */
  body: string
  shots?: GuideShot[]
}

/** 章节侧栏分组 */
export type GuideGroup = 'basic' | 'teacher' | 'system'

/** 教程章节：按访问角色过滤（minRole 及以上才可见） */
export type GuideChapter = {
  id: string
  title: string
  /** 可见所需的最低角色等级：1=学生 10=教师/管理员 100=超管 */
  minRole: number
  /** 侧栏分组 */
  group: GuideGroup
  /** 章首的一段话（口语化，两三句即可） */
  intro?: string
  sections: GuideSection[]
}

const sh = (id: string, src: string, caption: string): GuideShot => ({
  id,
  src,
  caption,
})

/** 侧栏分组标签 */
const GROUP_LABELS: Record<GuideGroup, string> = {
  basic: '快速上手',
  teacher: '日常教学',
  system: '系统配置',
}

const GUIDE_CHAPTERS: GuideChapter[] = [
  {
    id: 'start',
    title: '登录与界面',
    minRole: ROLE.USER,
    group: 'basic',
    intro:
      '先把登录跑通，再花两分钟认识界面。学生端的完整操作另有《学生使用指南》Word 文档，可从本页右上角下载。',
    sections: [
      {
        id: 'login',
        title: '1.1 两个登录入口',
        body: `
系统有两个登录入口，走错了会登不进去：

- **教师和管理员**用默认入口：填用户名（或邮箱）+ 密码。
- **学生**用学生入口：在登录卡底部点「教师 / 管理员登录」旁边那个链接的反方向——学生入口就是打开网址后默认看到的那一页，选年级、填账户名就行。

新装的系统自带一个超级管理员 **root / 123456**，第一次登录成功后，马上去「个人资料 → 安全与访问」把它改掉，别等到出事才想起来。

密码忘了找管理员在「账户管理 → API 用户」里重置。学生账号默认没有密码，留空就能进；教师在学生管理里可以随时给某个学生设置密码或恢复免密。
`.trim(),
        shots: [
          sh(
            'login',
            '/docs/guide/01-login.png',
            '教师/管理员登录入口：填用户名和密码'
          ),
          sh(
            'student-login',
            '/docs/guide/17-student-login.png',
            '学生登录入口：红框处从上到下依次选年级、填账户名（学号或姓名拼音）、填密码，最后点紫色「进入创作工坊」按钮'
          ),
        ],
      },
      {
        id: 'console',
        title: '1.2 认识控制台',
        body: `
进去以后界面就三块：

**左边是菜单**，所有功能都收在这里，菜单会跟着你的身份变——教师看不到超管才有的菜单，学生看到的是完全不同的创作台。**顶上固定三个入口**：控制台、模型广场、文档，位置永远不动。**右边是内容区**，筛选条件放顶部，操作按钮统一在右上角。

几个约定，第一次用花十秒记住就行：

- 下拉框都是**自己画的**，不是浏览器原生那种，点开选、再点收起。
- 新建、编辑、看详情都开**弹窗**，右上角 X 或点旁边空白处关掉；提交失败时弹窗**不会关**，错误写在里面，改完再提交。
- 筛选项**一改列表就刷**，不用再找「查询」按钮。
- 删除一类操作会弹确认框，确认了才真删。

登录后的落点不一样：超管进「概览」，教师进自己的控制台（教师去点概览会被踢回来），学生直接进创作台。看到页面和同事不一样是正常的，身份不同而已。
`.trim(),
        shots: [
          sh(
            'dashboard',
            '/docs/guide/16-dashboard-overview.png',
            '控制台：左侧菜单、顶部三个固定入口、右侧内容区'
          ),
        ],
      },
      {
        id: 'top-nav',
        title: '1.3 模型广场看什么',
        body: `
顶部点「模型广场」，这里是全部可用模型。教师看它主要为两件事：

**一是选型**。每个模型都标了能力（文生图、视频、音乐……），价格分好几档写清楚：非缓存输入、缓存输入、缓存写入、输出各是多少钱；音频类单独归一类，按音频输入、输出分别计价。

**二是拿模型 ID 接自己的工具**。模型卡上的名字可以一键复制，粘到 Chatbox、Codex 这类工具的模型名里，配上自己的 API Key 就能用（密钥在「个人资料 → API 密钥」里建）。这部分调用走**API 额度钱包**，按人民币算，跟课堂点数是两个钱包，互不串账。

价格不用背，生成的时候按钮旁边会显示这次要扣多少点，余额够不够一眼看到。
`.trim(),
        shots: [
          sh(
            'pricing-page',
            '/docs/guide/10-pricing.png',
            '模型广场：红框处是模型 ID（可复制），下方分档标出各类计价'
          ),
        ],
      },
    ],
  },
  {
    id: 'admin-class',
    title: '建班级、招学生',
    minRole: ROLE.ADMIN,
    group: 'teacher',
    intro:
      '行政大班是学生档案挂靠的单位。一个班从无到有就三步：建班、加学生、导点数，Excel 批量操作可以跳过前两步。',
    sections: [
      {
        id: 'class-list',
        title: '2.1 班级列表长什么样',
        body: `
进「学生与班级 → 行政大班」，列表一行一个班：班级编号、班级名、学部、届别、学生数、状态，行尾是编辑和删除。点**班级名**进这个班的详情（学生都在那儿管，见下一章）。

右上角三个按钮按顺序用：**下载导入模板** → **Excel 导入** → **新建班级**。上面还能按学部筛，改了马上生效。
`.trim(),
        shots: [
          sh(
            'class-list',
            '/docs/guide/03-classes-admin.png',
            '行政大班列表：红框处右上角三个按钮，点班级名进详情'
          ),
        ],
      },
      {
        id: 'class-create',
        title: '2.2 新建班级（两分钟）',
        body: `
点右上角「新建班级」，弹窗里这么填：

1. **班级名称**必填，比如「高一(3)班」，以后所有下拉里显示的就是它。
2. **班级编号**可以空着，保存时系统自动生成 \`C1001\` 这种（规则是 C + 1000 + 班级ID）。学校有自己的编号规则就自己填，生成的也能随时改。
3. **所属学部**下拉选，这个决定了学生账号的第一位字母。
4. **届别**填入学年份（2026 就是 2026 级），系统靠它算每个学生当前是几年级，以后学年结转一键搞定。
5. 班级说明随便写点备注，状态默认启用。

保存完班级立刻出现在列表里。
`.trim(),
        shots: [
          sh(
            'class-create',
            '/docs/guide/07-create-class-dialog.png',
            '新建班级弹窗：红框处依次填班级名、选学部、填届别'
          ),
        ],
      },
      {
        id: 'class-rules',
        title: '2.3 学号是怎么编出来的',
        body: `
学生账号固定 8 位，分三段：

\`\`\`
第1位       第2-3位        第4-8位
年级字母 + 届别后两位 + 5位顺序号

例：A  26  00007   →  A2600007
\`\`\`

年级字母（A/B/C 这种）在「学部管理」里配，一个学部一套。教师账号以 T 开头，管理员不走这套规则。

两个要注意的：

- 学生**默认没有密码**，直接登录；同班重名的学生会**各自建号**，拼音登录名自动加序号区分。
- 学生**毕业就自动锁**，登不进去了，但档案永远留着，不会被清掉——只有教师能主动删。
`.trim(),
      },
      {
        id: 'class-excel',
        title: '2.4 Excel 一次导完',
        body: `
班多的时候别一个个点，用 Excel。点「下载导入模板」拿到 \`workspace-import-template.xlsx\`，**就一个工作表、12 列**，行政班、小班、学生全在里面搞定。

每一行的意思是「谁的哪个班、哪几个学生」：

- **行政班**必填；同一个班名出现多行，就表示这几行都是它。
- **学部、届**只在该班**第一次出现**的那行填，后面的行留空。
- **小班1、小班2、小班3**：一个学生最多同时挂 3 个小班，**留空 = 不入该小班**；**不用先去小班管理里建好**，表里任意一列第一次出现这个小班名就自动创建（授课教师、类型、小班学部、AI课堂/HTML实验室开关在同一行填，对该行填的所有小班生效），一个老师带多个用中文「；」隔开。
- **学生姓名**留空 = 这行只定义班级和小班；填了名字就自动给这个学生建号。**一个学生只写一行**（要入的多个小班填在小班1/2/3 列，别拆成多行），**同班重名的学生按出现顺序各自建号**，不会被合并成一个人。

点「导入 Excel」选文件，跑完告诉你建了几个、更新了几个，**哪一行错了会单独列出来**（比如授课教师填了个学生 ID，会被拦下）。改好那几行重传同一个文件就行——已经成功的行按名称和出现顺序匹配，**不会重复建**。
`.trim(),
        shots: [
          sh(
            'excel-import',
            '/docs/guide/06-elective-import.png',
            'Excel 导入：授课教师支持中文「；」多选，失败行会逐条列出原因'
          ),
        ],
      },
    ],
  },
  {
    id: 'students',
    title: '学生与点数',
    minRole: ROLE.ADMIN,
    group: 'teacher',
    intro:
      '点学生名进班级详情，加人、改资料、发点数都在这一页。点数是学生的命根子，发错了能追回来——每次下发都有记录。',
    sections: [
      {
        id: 'class-detail',
        title: '3.1 班级详情里的学生名单',
        body: `
在班级列表**点班级名**进来，主体就是学生名单表：学号（可一键复制）、姓名、姓名拼音、所属小班、剩余点数、已用点数、状态。

顶上三个按钮：

- **批量新建学生账号**：每行只填姓名，拼音自动生成。
- **添加已有账号**：按学号把别的班的学生拉进本班。
- 勾中几个学生后，多出**修改点数**、**批量分发**、**清零已用点数**几个批量操作。

下面两节分别说批量建号和发点数。
`.trim(),
        shots: [
          sh(
            'class-detail',
            '/docs/guide/08-student-list.png',
            '班级详情：点班级名进来就是这张学生名单表'
          ),
        ],
      },
      {
        id: 'student-edit',
        title: '3.2 加学生：批量与单个',
        body: `
**批量加**（人多用这个）：点「批量新建学生账号」，弹窗里一行一个姓名，拼音自动跟着出来。同班拼音撞了（比如两个张伟）**会报中文错误、弹窗不关**，你把那一行改掉再提交就行——系统不会替你悄悄覆盖。

**单个加或改**：点学生行的编辑，字段一样——姓名、姓名拼音（可手改）、学号（自动生成，导入的以表里为准）、所属班级、初始点数。

**密码**：学生默认免密。想让他设密码，学生行上点「重置密码」；想让他回到免密，点「恢复免密登录」。
`.trim(),
        shots: [
          sh(
            'students',
            '/docs/guide/04-students.png',
            '学生列表：右上角「批量新建学生账号」，行内编辑与密码重置'
          ),
        ],
      },
      {
        id: 'points',
        title: '3.3 给学生发点数',
        body: `
学生的点数就**一个总数**，不分项。每个功能扣多少（文生图 5 点一次这种）是超管在「模型定价」里定的，学生只管看余额够不够。

发点数有四条路，**推荐第一条**：

1. **小班里发**（日常课堂用这个）——小班详情弹窗点「分发点数」，选「设置为指定点数」或「清零」，填每人多少。**不勾人 = 全班都发**，勾了人 = 只发勾中的，提示会实时显示「勾选 3 人 / 全班 32 人」。
2. **班级详情批量发**——勾几个学生，点「批量分发」。
3. **全班一键下发**——班级详情顶部，给整个班设成统一的剩余点数。
4. **只清已用统计**——「账户管理」里有「清零已用」，把「已用」归零，**不动剩余点数**，用来修正统计。

每次发放都会记在「使用记录」里，能按班级、按时间翻出来查。学生那边右上角只显示纯点数（没有美元符号），数据看板里同时给出折算成的钱数。
`.trim(),
      },
    ],
  },
  {
    id: 'small-class',
    title: '上课小班',
    minRole: ROLE.ADMIN,
    group: 'teacher',
    intro:
      '上课小班是真正上课时用的分组，一个学生可以同时在好几个小班里。点数下发、账户导出、AI 开关都在小班里操作。',
    sections: [
      {
        id: 'small-class-list',
        title: '4.1 小班列表与两个开关',
        body: `
「学生与班级 → 上课小班」标签页，一行一个小班。

**所属行政班**和**授课教师**都能**多选**（一个老师带好几个小班很常见）。每行两个开关：

- **AI 课堂**：关了，这个小班的学生端就看不到任何 AI 生成入口，只剩任务提交。
- **HTML 实验室**：默认关，开了学生端才出现那个 Beta 菜单。

行内按钮：**详情**（日常操作都在这）、**导入学生**、**编辑**、**删除**。页面顶部也有独立的 **Excel 导入**，和行政班共用同一张模板。
`.trim(),
        shots: [
          sh(
            'small-class',
            '/docs/guide/04-small-classes.png',
            '上课小班列表：红框处两个开关分别控制 AI 课堂与 HTML 实验室'
          ),
        ],
      },
      {
        id: 'small-class-detail',
        title: '4.2 小班详情：拉人、发点数、导账户',
        body: `
点小班行的「**详情**」，弹窗里三块事：

**① 成员名单**

名单里直接显示每个学生的**剩余点数**和**已用点数**，发之前先看一眼余额。上面一个搜索框（可全选）列出**属于行政班但还没进这个小班**的学生，勾中点「拉入行政班学生 N 人」；反过来勾中已有的成员点「移出所选 N 人」。移出只影响当前小班，学生在别的小班还在。

**② 分发点数**

点「分发点数」展开，选「设置为指定点数」或「清零」，填数值。**注意：不勾任何成员时，是给全班发**；勾了就只发勾中的。确定后名单里的点数列当场变。

**③ 下载账户信息**

点「下载账户信息」拿到一个 \`{小班名}-账户信息.xlsx\`，列有学号、账户名、姓名拼音、姓名、班级、年级、剩余/已用点数、密码、状态。**密码列会写明是「已设置密码」还是「免密登录」**，状态列区分在读、已毕业、已停用——发给学生当登录清单正合适。
`.trim(),
        shots: [
          sh(
            'members',
            '/docs/guide/05-members.png',
            '小班详情：上方搜索行政班学生拉入，名单列显示实时点数'
          ),
          sh(
            'members-selected',
            '/docs/guide/06-members-selected.png',
            '勾选学生后按钮变成「拉入行政班学生 N 人」，发送点数时同样按勾选生效'
          ),
        ],
      },
    ],
  },
  {
    id: 'lesson-plan',
    title: '备课',
    minRole: ROLE.ADMIN,
    group: 'teacher',
    intro:
      '备课按「年级 → 单元 → 课时 → 任务」套下去。备一次课能反复分发，学生交的每次都不丢；临时想布置任务不用备课，见下一章。',
    sections: [
      {
        id: 'lesson-plans',
        title: '5.1 单元、课时、任务怎么套',
        body: `
进「备课模式」，**先选学部和年级**（年级是按入学年份自动算的，不用你建）。

然后一层层往下点：

1. **新建单元**：一个单元对应教材一章，填名称和说明。
2. **新建课时**：单元里再分课时，填标题。有个**是否 AI 课程**开关——关了，这个课时学生端就**一个 AI 入口都不出**，纯交作业的课用得上。
3. **新建任务**：课时里拆成几个小任务，每个任务填**标题**和**任务要求**（学生创作前必读），再选**产出形式**，三选一：
   - **大段文字**——学生直接在框里打字提交；
   - **文件上传**——学生传作业文件，另外要填允许的后缀（比如 .docx,.pdf）和最多传几个；
   - **AI 作品**——学生在任务里调中台生成，交生成结果。
4. 任务有**排序**字段，决定学生端从上到下怎么排。课时还支持**整体复制**，把任务结构一起拷过去改改就能用。
`.trim(),
        shots: [
          sh(
            'lesson-plans',
            '/docs/guide/29-lesson-plans.png',
            '备课模式：左边年级单元树，右边课时与任务列表'
          ),
          sh(
            'lesson-edit',
            '/docs/guide/07-lesson.png',
            '课时与任务配置：红框处「是否 AI 课程」决定学生端有没有 AI 入口'
          ),
        ],
      },
      {
        id: 'lesson-excel',
        title: '5.2 Excel 批量导备课',
        body: `
备课页右上角「**下载导入模板**」拿 \`workspace-lesson-import-template.xlsx\`（13 列，一个工作表），「**Excel 导入**」上传。

填表就一条要诀：**空单元格 = 沿用上一行**。所以同一个学部、年级、单元、课时，只在**第一行**填，后面几行留空——一个课时要建三个任务，就是连续三行，只有第一行写课时名，三行各写各的「任务标题、任务要求、产出形式」。

「是否AI课程」填是/否，「产出形式」填大段文字/文件上传/AI 作品。系统按名称匹配：**已有的更新，没有的新建**，跑完给你一张「新建 X / 更新 Y」的汇总。哪行错了（比如产出形式写错字）会列出行号，改好重传同一个文件，**成功的行不会重复建**。
`.trim(),
      },
    ],
  },
  {
    id: 'teaching',
    title: '上课与收作业',
    minRole: ROLE.ADMIN,
    group: 'teacher',
    intro:
      '完整一节课的流程：把任务发下去 → 学生交作业 → 你盯着完成情况 → 下课打包收走。备课发和临时发都走这同一条路。',
    sections: [
      {
        id: 'distribute',
        title: '6.1 把课发下去',
        body: `
进「课堂概览」，上面「授课分发」卡片里连着选四下：**学部 → 年级 → 上课小班 → 课时**，然后填个**本节课主题**（不填就用课时标题，改成当天的课题更清楚），点「一键分发」。

分发完，学生那边任务面板**立刻就出来了**，不用刷新等半天。

两个细节：

- **同一个方案、同一个班再发一次，是接着上次的进度继续**，之前交的作业都还在。有学生迟到、整节课重上，都不会把数据冲掉。
- 下面的「**课堂会话**」列表就是每次课的存档：状态（授课中/已结束）、小班、课时、任务数、提交数、时间，新的在最上面。
`.trim(),
        shots: [
          sh(
            'distribute',
            '/docs/guide/02-overview.png',
            '课堂概览：上半区四连选分发，下半区是历次课堂会话列表'
          ),
        ],
      },
      {
        id: 'temp-class',
        title: '6.2 临时发起课堂（不用备课）',
        body: `
没提前备课、想当场布置几个任务，点课堂概览右上角的「**临时发起课堂**」（单班视图和总览页都有这个按钮）。

1. 先确认左上角**当前小班**选对了（没选小班按钮是灰的）。
2. 填本节课主题，不填默认「临时课堂」。
3. **任务环节数量**下拉选 1 到 12，下面自动生成对应张卡片。
4. 每张卡片里：环节名（空着自动叫任务1、任务2…）、任务要求（给学生看的话）、**提交内容勾选框**——文字、文件、AI 作品，至少勾一个，学生就只能用你勾的方式交。
5. 点「**发起课堂**」。

发完学生端马上收到。注意：这个班**之前还在进行中的其它课会自动结束**，学生端永远只有一个「当前课时」，不会串。
`.trim(),
        shots: [
          sh(
            'temp-class',
            '/docs/guide/37-temp-class-modal.png',
            '临时发起课堂弹窗：红框处选任务环节数量，每张环节卡片勾选学生能用的提交内容'
          ),
        ],
      },
      {
        id: 'progress',
        title: '6.3 盯完成情况（实时）',
        body: `
课堂详情往下拉，有个「**完成情况（实时）**」表格，**每 10 秒自己刷新**，不用你手动刷。

这张表是「学生 × 任务」的格子：**一行一个学生**（一个任务都没交的也列出来，不会漏人），**一列一个任务**，格子里写着「已完成 ×次」或者「未完成」。右边还有**完成度**（交了几个任务/总共几个）和「**查看详情**」。最上面一排统计直接告诉你全班「已完成 X / Y 人」——课上拿这个催交最直观。

点某行「**查看详情**」，弹窗里是这个学生本节课的全部家当：按任务一块块列出来，每条提交的**正文、提示词、提交时间**都在；AI 作品还能点「详情」看参数和生成结果、点「预览」直接看图。
`.trim(),
        shots: [
          sh(
            'progress-matrix',
            '/docs/guide/38-progress-matrix.png',
            '完成情况矩阵：红框处一行是学生、一列是任务，格子写完成状态'
          ),
        ],
      },
      {
        id: 'submissions',
        title: '6.4 看作业与打包下载',
        body: `
会话列表点「查看」进课堂视图，能按任务、按学生筛选着看提交，文本直接显示，图片在线预览。AI 作品点开详情能看到学生用的**提示词和参数**——讲评的时候这个最好用。

右上角「**打包下载 ZIP**」，一次把整节课的成果全下下来：

- **文字作业**存成 \`任务_学生_文字.txt\`，文件里**提示词（使用要求）和提交正文都在**——纯文字交的作业全靠这个，不然只剩正文没上下文。
- 图片、视频、音频、上传的文件按原样打包，旁边配一个 \`_说明.txt\`，写清提示词、参数和生成结果。
- AI 作品没落盘文件的（纯文字生成），写进 \`_结果文字.txt\`，**不会丢**。

文件名会转成拼音、重名自动加序号，中文路径不会乱。
`.trim(),
        shots: [
          sh(
            'submissions',
            '/docs/guide/12-class-overview.png',
            '课堂视图：上方筛选与打包下载按钮，下方逐条学生提交'
          ),
        ],
      },
    ],
  },
  {
    id: 'insights',
    title: '查学情',
    minRole: ROLE.ADMIN,
    group: 'teacher',
    intro:
      '学情管理页顶上两个标签：「使用统计」看学生用了多少，「历史课堂」回看每次课交了什么——这两类数据分开摆，不再挤一页。',
    sections: [
      {
        id: 'insights-stats',
        title: '7.1 使用统计',
        body: `
进「AI 中台 → 学情管理」，默认就在「使用统计」标签。

**顶上四张汇总卡**：学生总数、有生成学生（区间内至少生成过一次的，跟总数一比就知道有多少人从没用过）、生成次数、消耗点数与消费金额。

**中间筛选**：时间范围默认本月，可以自己改起止日期；学部、年级、班级**逐级收窄**，再用姓名搜索框（姓名/学号/账户名都行）定位到具体人。右上角「**包含已毕业**」开关决定要不要把毕业生算进来。

**下面明细表**：姓名、学号、班级、年级、生成次数、消耗点数、消费金额、最近活跃时间、能力分布。能力分布是标签形式（「文生图 ×12」「文生文 ×5」），一眼看出这孩子偏好哪样。**从没生成过的学生，次数列显示「无生成」**，默认按次数从多到少排——找那些一节课都没动手的，直接翻最后一行。
`.trim(),
      },
      {
        id: 'insights-history',
        title: '7.2 历史课堂',
        body: `
切到「**历史课堂**」标签，这里是备课发的、临时发的每次课的提交数据，按小班归好：

1. 先选**班级**（可选），选了以后小班下拉就只剩这个班的；
2. 再选**小班**，下面列出它的全部课堂：状态、单元/课时、主题、任务数、提交数、开始时间；
3. 点某行「**查看提交**」，下面展开明细——学生、学号、任务、提交形式、内容摘要、提交时间；
4. 右上角「**打包下载 ZIP**」导出这次课（打包内容和 6.4 一样，含文字作业和提示词）。

**不选小班就不给数据**，故意的——防止跨班的数据混在一张表里看着乱。
`.trim(),
        shots: [
          sh(
            'history-lessons',
            '/docs/guide/39-history-lessons.png',
            '历史课堂：红框处先选班级再选小班，下方列出该小班历次课堂'
          ),
        ],
      },
      {
        id: 'usage-records',
        title: '7.3 使用记录：查、导、删',
        body: `
「AI 中台 → 使用记录」是全部学生的生成流水，**筛选固定三级**：

1. 第一级选**年级**；
2. 第二级在选出的年级里选**班级**；
3. 第三级搜索框输**账号或姓名**，直接钉到某个人。

另外还有时间范围、生成模式（文生文/文生图…）两个筛选，「**包含已毕业**」开关默认不含毕业生。

列表里点**详情**，弹窗上半是学生发的**原文**，下半是模型回的**完整结果**，图片直接显示、点开能放大。右上角「打包下载」勾几条导几条；图片类的产物教师可以单独删（**只删本地文件，记录档案留着**）——磁盘不够用了就来这儿清图和视频。
`.trim(),
        shots: [
          sh(
            'usage-records',
            '/docs/guide/11-records.png',
            '使用记录：年级 → 班级 → 搜索框三级筛选，行内可看详情'
          ),
        ],
      },
    ],
  },
  {
    id: 'teacher-personal',
    title: '教师自己用的功能',
    minRole: ROLE.ADMIN,
    group: 'teacher',
    intro:
      '这章跟你教的班没关系，是你自己用的：API 密钥、点数钱包、HTML 实验室。充值、兑换码、订阅那些对教师端全藏起来了。',
    sections: [
      {
        id: 'api-keys',
        title: '8.1 建 API 密钥接外部工具',
        body: `
想在 Chatbox、Codex 这类工具里用咱们的模型：

1. 顶上「模型广场」挑好模型，**复制模型 ID**。
2. 「个人资料 → API 密钥」点创建，复制那串 sk- 开头的密钥（只显示一次，丢了重建）。
3. 第三方工具里填三样：系统地址、你的密钥、模型 ID。

调用扣的是**API 额度钱包**（按人民币），跟课堂点数两本账，别搞混。
`.trim(),
      },
      {
        id: 'wallet',
        title: '8.2 点数钱包',
        body: `
「AI 中台 → 教师点数钱包」里两个钱包分开摆：

- **课堂点数钱包**：给你学生发的那些点数，收支按班级、按学生留痕；
- **API 额度钱包**：API 调用花的钱，人民币计费。

页面只有**剩余点数、已用点数、调用次数**三项，**没有充值按钮**——要钱走管理员给你按月配发放规则，每月自动到账。钱包、充值、兑换码、订阅这些资金入口对教师端全部隐藏。
`.trim(),
      },
      {
        id: 'html-lab',
        title: '8.3 HTML 实验室（Beta）',
        body: `
**是什么**：用聊天的方式生成网页。你说「做个课程表页面，要能按周切换」，它给一个能直接跑的 HTML/CSS/JS 单文件，右边实时预览。信息技术课、创意作业用它很顺手。菜单上带 **Beta** 标，意思是还在公开测试。

**怎么进来**：教师端在「AI 创作」菜单下直接有。学生端要老师在**小班管理里开「HTML 实验室」开关**（默认关）才有入口。全局默认思考强度由超管在「模型定价 → 平台设置」里设，进去是这个初始值，顶栏能随时改。

**几条规则**：

- **一次 5 点**（后台可调），**生成成功才扣**，提示「本次未生成代码」的那次不扣。
- 项目能改名，列表 10 条一页带搜索。
- 翻译回来的上下文保留最近 **12 条对话 / 3000 字**，存库上限 2 万字。
- 允许外链图片和 CSS；每次生成**自动记进使用记录和云端素材**。
`.trim(),
        shots: [
          sh(
            'html-lab',
            '/docs/guide/33-student-html-lab.png',
            'HTML 实验室：左侧对话生成，右侧实时预览'
          ),
        ],
      },
    ],
  },
  {
    id: 'channels-models',
    title: '接渠道、管模型',
    minRole: ROLE.SUPER_ADMIN,
    group: 'system',
    intro:
      '只有超管看得到这章。配的顺序固定：先接渠道（模型服务商），再管模型，然后声明能力，最后定价。顺序反了前端下拉是空的。',
    sections: [
      {
        id: 'channels',
        title: '9.1 渠道：接模型服务商',
        body: `
「AI 中台 → 渠道」。一张卡片一个渠道，上面写着优先级、权重、用了多少、还剩多少、响应耗时、上次测试结果。

「创建渠道」弹窗四步：选**供应商类型**（OpenAI 兼容、通用 JSON 等）→ 填 **API 地址**和**密钥** → 勾这个渠道有哪些**模型** → 设**分组**、优先级、权重。存完右上角一键**测试**通不通。

**最常踩的坑**：OpenAI 兼容渠道的地址**末尾别带 /v1**。系统会自己拼，你写了就变成 \`/v1/v1/...\`，上游直接 404。

地址里也能写死路径（\`/chat/completions\`、\`/images/generations\`），非标准协议的用通用 JSON 类型 + 自定义路径。高级项里还有透传请求体/头、异常自动禁用、模型重定向。卡片能**拖拽调优先级**，支持批量启停和按状态/类型/分组筛。
`.trim(),
        shots: [
          sh(
            'channels',
            '/docs/guide/21-channels.png',
            '渠道列表：卡片上方是状态与测试结果，右上角筛选和创建入口'
          ),
          sh(
            'channel-menu',
            '/docs/guide/22-channel-menu.png',
            '创建渠道第一步：选供应商类型'
          ),
          sh(
            'channel-edit',
            '/docs/guide/23-channel-edit.png',
            '编辑渠道：红框处 API 地址不要带 /v1，下方勾选该渠道的模型'
          ),
        ],
      },
      {
        id: 'models',
        title: '9.2 模型管理',
        body: `
「AI 中台 → 模型管理」三个标签：**模型 / 供应商 / 部署**，日常只用第一个。

模型列表一行一个模型，列着定价、广场是否展示、挂的渠道和分组、标签。行内两个按钮：

- **补充资料**：弹窗分四块——**模型资料**（名称、简介、上下文）、**生成能力**、**定价**、**渠道与分组**，各块**独立保存**，改一块存一块。
- **定价**：直接跳到这个模型的计价。

右上角两个同步按钮：渠道加了新模型、或者上游调价了，点「**同步资料 / 同步价格**」拉一遍。渠道外的模型用「**添加模型**」手动登记。

**模型名称旁边有复制按钮**，复制出来的就是模型 ID，模型广场上展示给用户的就是它。**删模型的时候，能力声明会一起清掉**，前端下拉不会留个死选项出来——这条是以前出过 bug 加的。
`.trim(),
        shots: [
          sh('models', '/docs/guide/24-models.png', '模型管理列表'),
          sh(
            'model-meta',
            '/docs/guide/25-model-meta.png',
            '补充资料弹窗：四块分区，各块独立保存'
          ),
        ],
      },
    ],
  },
  {
    id: 'capability-pricing',
    title: '声明能力、配置价格',
    minRole: ROLE.SUPER_ADMIN,
    group: 'system',
    intro:
      '两步定死学生端「能用什么模型、一次扣多少点」。先在模型详情声明能力，再到模型定价配计价，顺序不能倒。',
    sections: [
      {
        id: 'capability',
        title: '10.1 生成能力与开放范围',
        body: `
模型详情切到「**生成能力**」分区：

1. **勾能力**：文生文、文生图、图生图、视频生成、音乐生成、声音合成、HTML 实验室，勾几个前端下拉就显示几个（**只勾一个也还是下拉框**，不改成按钮）。
2. **开放范围**三选一：学生和教师都能用 / **仅学生** / **仅教师**。前端按这个过滤，**服务端也再查一遍**——直接改请求绕不过去。
3. 每个能力**单独**配：
   - 请求格式：OpenAI 对话格式，或者**通用 JSON**（对方不是 OpenAI 协议就用这个）；
   - 接口路径：\`/chat/completions\`、\`/images/generations\` 等；
   - **请求方法**：POST 或 GET（有的老接口只要 GET）；
   - **附加参数 JSON**：按「模型 × 功能」各存一份，请求时**合并覆盖**进请求体，改这里不用改代码。
4. 声音合成还要填**音色列表**，学生端按你填的顺序下拉选。

顺带记一下：**模型删掉时，它在这里的声明会一并删**，前端不会残留。
`.trim(),
        shots: [
          sh(
            'capability',
            '/docs/guide/26-model-capability.png',
            '生成能力分区：上半勾能力与开放范围，下半每个能力单独配请求方式'
          ),
        ],
      },
      {
        id: 'pricing',
        title: '10.2 模型定价',
        body: `
「AI 中台 → 模型定价」。原来看的「定价规则」和「额度规则」两个页是同一份数据，已经合成这一个页，**只在这儿改**。

从上到下四块：

1. **平台设置**：中台展示名、HTML 实验室的全局默认思考强度。
2. **能力点数（按能力统一）**：同一个能力下所有模型共用一个单次消耗，比如文生图统一 5 点/次。**按次扣，不按量**——成功生成一次扣一次。
3. **模型倍率与上游定价**：模型倍率、补全倍率与工具价格就是上游计费口径，系统自动换算成单价，**不用手工填**。
4. 改完点右上角「**保存定价**」。

**月度对账**能按学生、按班级算消费总额，再跟 API 接入侧的总价对。

**学生点数不够会怎样**：每个功能的消耗加起来超过学生总点数上限时，学生端生成按钮直接置灰并提示还差多少点。
`.trim(),
        shots: [
          sh(
            'pricing',
            '/docs/guide/28-pricing-hub.png',
            '模型定价：能力点数与模型倍率两块，右上角保存'
          ),
        ],
      },
    ],
  },
  {
    id: 'admin-system',
    title: '系统设置',
    minRole: ROLE.SUPER_ADMIN,
    group: 'system',
    intro: '学部年级规则、素材磁盘、登录集成、限流与日志，都在这章。',
    sections: [
      {
        id: 'section-grade',
        title: '11.1 学部管理与学年结转',
        body: `
「学部管理」管年级规则。每个学部一行：**代号**（就是学生账号第一位字母，P/J/S）、名称、学制几年、几个年级、几月升级、**毕业冻结开关**。系统自带小学、初中、高中三个，能改能加，年级字母（A/B/C…）配在学部下面。

「**学部总览**」按学部 × 年级列出班级数和在读人数，上面有个「**一键学年结转**」——新学年点一下，全部学生的年级重算完，不用一个个改。

学制读完的学生显示「**已毕业**」，开了毕业冻结就登不进（档案保留）。校区、学段那些旧概念已经移除了，班级名统一「年级编号 + 字母」。
`.trim(),
        shots: [
          sh(
            'grades',
            '/docs/guide/13-grades.png',
            '学部管理与学部总览：一键学年结转在总览顶部'
          ),
        ],
      },
      {
        id: 'artifacts',
        title: '11.2 云端素材：磁盘管家',
        body: `
「AI 中台 → 云端素材」是**所有生成产物的仓库**（图片、视频、音乐、音频、文本），全存在服务器本地磁盘 \`./data/workspace-artifacts\`，走带鉴权的接口分发——没有对象存储、没有 CDN，内网跑就够了。

- 顶上按**时间段、班级、类型**筛。
- 勾选后「**批量清理**」删本地文件；**只删文件不删记录**，删了之后这条素材不能下载了。
- **自动删除**配置：素材从创建起满 N 天自动删文件，只留记录——磁盘紧张就开这个。
- **生成记录永久保留**，跟素材文件是两回事。
`.trim(),
        shots: [
          sh(
            'storage',
            '/docs/guide/08-storage.png',
            '云端素材列表：批量清理与自动删除配置'
          ),
        ],
      },
      {
        id: 'system',
        title: '11.3 系统设置里该动的几项',
        body: `
**OAuth 扫码登录**：「OAuth 集成」里配企业微信（CorpID / AgentId / Secret）和飞书（App ID / App Secret），存完就能扫码登。绑定方式是：**先用账号密码登进去 → 个人资料页点绑定按钮 → 扫一次码自动绑上**。两个平台都限**单企业**用，没绑过的第三方身份不给自助注册，会提示先去绑定。

**请求策略**里的两个开关：

- **每日余额检查**：开了以后后台每 24 小时把启用的渠道余额刷一遍；有的渠道没余额查询接口，自动跳过、不报错。
- **余额预警阈值**：任一渠道余额低于这个数，就给开了通知的管理员发一条汇总提醒。**设 0 就是关掉**。预警只提醒，**不会自动禁用渠道**。

**限流参数（重点）**：\`CRITICAL_RATE_LIMIT\`、\`GLOBAL_API_RATE_LIMIT\` 生产环境**必须调到 3000 以上**。教室里几十个学生同一个出口 IP 一起发请求，默认值会把他们全拦了，前端还只是报个空响应的错，特别难查。

**日志维护**：审计日志、使用记录、任务日志的查询和清空在这儿；多类型批量删除那个功能暂时没开放，现在保留的是一键清空。

**文档入口**：官方文档外链地址在这里配；站内图文教程（就是你现在看的这个页面）教师和管理员一直可见。
`.trim(),
      },
    ],
  },
]

/**
 * 教程正文排版样式（追加到 Markdown 组件默认 prose 类之后覆盖）。
 */
const GUIDE_PROSE_CLASS = [
  '[&]:font-[Inter,PingFang_SC,Microsoft_YaHei,system-ui,sans-serif]',
  '[&_p]:my-2.5 [&_p]:text-[15px] [&_p]:leading-[1.9]',
  '[&_li]:text-[15px] [&_li]:leading-[1.85]',
  '[&_strong]:font-semibold [&_strong]:text-primary dark:[&_strong]:text-primary',
  '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-[15px] [&_h3]:font-semibold',
  '[&_ul]:my-2.5 [&_ol]:my-2.5 [&_ul]:space-y-1.5 [&_ol]:space-y-1.5',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-primary/40',
  '[&_img]:mx-auto',
  '[&_table]:text-[14px] [&_table]:my-3',
  '[&_th]:bg-muted/60',
].join(' ')

/**
 * 教程配图组件。
 *
 * - `src` 为空：渲染虚线占位块，显示 caption 与「示意图待补」。
 * - `src` 有值：渲染真实图片，caption 同时作为 alt。
 */
export function GuideFigure({
  src,
  caption,
}: {
  src: string
  caption: string
}) {
  const { t } = useTranslation()

  if (!src) {
    return (
      <figure className='my-4'>
        <div className='border-border bg-muted/30 flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center'>
          <span className='text-muted-foreground text-xs font-medium'>
            {t('示意图待补')}
          </span>
          <figcaption className='text-muted-foreground text-xs'>
            {caption}
          </figcaption>
        </div>
      </figure>
    )
  }

  return (
    <figure className='my-4'>
      <img
        src={src}
        alt={caption}
        loading='lazy'
        className='border-border mx-auto w-full max-w-2xl rounded-lg border shadow-sm'
      />
      <figcaption className='text-muted-foreground mt-2 text-xs leading-relaxed'>
        <span className='bg-primary/10 text-primary mr-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium'>
          {t('看哪里')}
        </span>
        {caption}
      </figcaption>
    </figure>
  )
}

/**
 * 全平台使用教程页面：左侧分组章节导航（含小节锚点）+ 右侧章节卡片流。
 */
export function WorkspaceGuidePage() {
  const { t } = useTranslation()
  const role = useAuthStore((s) => s.auth.user?.role ?? 0)

  const chapters = useMemo(
    () => GUIDE_CHAPTERS.filter((c) => role >= c.minRole),
    [role]
  )

  const [activeId, setActiveId] = useState(() => chapters[0]?.id ?? '')

  useEffect(() => {
    if (!chapters.some((c) => c.id === activeId)) {
      setActiveId(chapters[0]?.id ?? '')
    }
  }, [chapters, activeId])

  const active = chapters.find((c) => c.id === activeId) ?? chapters[0]
  const activeIndex = active
    ? chapters.findIndex((c) => c.id === active.id)
    : -1
  const prevChapter = activeIndex > 0 ? chapters[activeIndex - 1] : null
  const nextChapter =
    activeIndex >= 0 && activeIndex < chapters.length - 1
      ? chapters[activeIndex + 1]
      : null

  /** 侧栏按 group 连续分组 */
  const grouped = useMemo(() => {
    const result: { label: string; items: GuideChapter[] }[] = []
    for (const chapter of chapters) {
      const label = GROUP_LABELS[chapter.group]
      const last = result.at(-1)
      if (last && last.label === label) last.items.push(chapter)
      else result.push({ label, items: [chapter] })
    }
    return result
  }, [chapters])

  /** 点击章节/小节：切换章节并滚动到对应锚点 */
  const goto = (chapterId: string, sectionId?: string) => {
    setActiveId(chapterId)
    window.setTimeout(() => {
      const el = sectionId
        ? document.getElementById(`guide-sec-${sectionId}`)
        : document.getElementById('guide-article-top')
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  return (
    <div className='flex min-h-0 w-full flex-1 overflow-hidden'>
      {/* 章节导航：分组标题 + 章节（激活章节展开小节锚点） */}
      <nav className='border-border bg-card w-56 shrink-0 overflow-y-auto border-r px-2 py-4 lg:w-64'>
        <p className='text-muted-foreground px-2 pb-3 text-xs font-semibold tracking-wide uppercase'>
          {t('使用教程')}
        </p>
        <div className='flex flex-col gap-4'>
          {grouped.map((group) => (
            <div key={group.label}>
              <p className='text-muted-foreground/80 px-2 pb-1.5 text-[11px] font-semibold tracking-wider'>
                {t(group.label, { defaultValue: group.label })}
              </p>
              <ul className='flex flex-col gap-0.5'>
                {group.items.map((chapter) => {
                  const isActive = chapter.id === active?.id
                  return (
                    <li key={chapter.id}>
                      <button
                        type='button'
                        onClick={() => goto(chapter.id)}
                        className={`w-full rounded-md px-2 py-2 text-left text-sm transition-colors ${
                          isActive
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        {t(chapter.title, { defaultValue: chapter.title })}
                      </button>

                      {isActive && chapter.sections.length > 0 && (
                        <ul className='border-border mt-0.5 flex flex-col border-l pl-2'>
                          {chapter.sections.map((section) => (
                            <li key={section.id}>
                              <button
                                type='button'
                                onClick={() => goto(chapter.id, section.id)}
                                className='text-muted-foreground hover:bg-muted hover:text-foreground w-full rounded px-2 py-1.5 text-left text-xs leading-snug transition-colors'
                              >
                                {t(section.title, {
                                  defaultValue: section.title,
                                })}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* 正文：章节头 + 小节卡片流 + 翻页导航 */}
      <div className='min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-8'>
        {active && (
          <div id='guide-article-top' className='w-full scroll-mt-4'>
            {/* 章节头：编号 + 标题 + 一段话 */}
            <header className='border-border bg-card rounded-xl border p-5 shadow-sm sm:p-7'>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div className='min-w-0'>
                  <p className='text-muted-foreground text-xs font-medium tracking-wide'>
                    {t('第 {{n}} 章 / 共 {{total}} 章', {
                      n: activeIndex + 1,
                      total: chapters.length,
                    })}
                  </p>
                  <h1 className='text-foreground mt-1 text-2xl font-semibold'>
                    {t(active.title, { defaultValue: active.title })}
                  </h1>
                </div>
                <a
                  href='/docs/AIWorkspace-student-guide.docx'
                  download
                  className='border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors'
                >
                  <svg
                    viewBox='0 0 24 24'
                    className='h-3.5 w-3.5'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    aria-hidden='true'
                  >
                    <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                    <polyline points='7 10 12 15 17 10' />
                    <line x1='12' y1='15' x2='12' y2='3' />
                  </svg>
                  {t('下载《学生使用指南》Word 版')}
                </a>
              </div>

              {active.intro && (
                <p className='text-muted-foreground mt-3 max-w-3xl text-sm leading-relaxed'>
                  {t(active.intro, { defaultValue: active.intro })}
                </p>
              )}
            </header>

            {/* 小节：每节一张独立卡片 */}
            {active.sections.map((section) => (
              <section
                key={section.id}
                id={`guide-sec-${section.id}`}
                className='border-border bg-card mt-4 scroll-mt-4 rounded-xl border p-5 shadow-sm sm:p-6'
              >
                <h2 className='border-border text-foreground mb-3 border-b pb-3 text-lg font-semibold'>
                  {t(section.title, { defaultValue: section.title })}
                </h2>
                <div className='overflow-x-auto'>
                  <Markdown className={GUIDE_PROSE_CLASS}>
                    {t(section.body, { defaultValue: section.body })}
                  </Markdown>
                </div>
                {section.shots?.map((shot) => (
                  <GuideFigure
                    key={shot.id}
                    src={shot.src}
                    caption={t(shot.caption, { defaultValue: shot.caption })}
                  />
                ))}
              </section>
            ))}

            {/* 上一章 / 下一章 */}
            <nav className='mt-6 flex flex-col gap-3 sm:flex-row sm:justify-between'>
              {prevChapter ? (
                <button
                  type='button'
                  onClick={() => goto(prevChapter.id)}
                  className='group border-border bg-card hover:border-primary/40 hover:bg-accent/50 flex max-w-full flex-col rounded-lg border px-4 py-3 text-left transition-colors'
                >
                  <span className='text-muted-foreground text-xs'>
                    {t('上一章')}
                  </span>
                  <span className='text-foreground group-hover:text-primary mt-0.5 truncate text-sm font-medium'>
                    {t(prevChapter.title, { defaultValue: prevChapter.title })}
                  </span>
                </button>
              ) : (
                <span />
              )}
              {nextChapter ? (
                <button
                  type='button'
                  onClick={() => goto(nextChapter.id)}
                  className='group border-border bg-card hover:border-primary/40 hover:bg-accent/50 flex max-w-full flex-col rounded-lg border px-4 py-3 text-right transition-colors sm:items-end'
                >
                  <span className='text-muted-foreground text-xs'>
                    {t('下一章')}
                  </span>
                  <span className='text-foreground group-hover:text-primary mt-0.5 truncate text-sm font-medium'>
                    {t(nextChapter.title, { defaultValue: nextChapter.title })}
                  </span>
                </button>
              ) : (
                <span />
              )}
            </nav>
          </div>
        )}
      </div>
    </div>
  )
}
