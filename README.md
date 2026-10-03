# Yufu0u-blog

[博客](https://yufu0u-blog-qogjsurz.edgeone.dev/) · [Shirone 上游](https://github.com/LyraVoid/Shirone)

基于 Shirone 的公开主题工程，采用 Astro 7、Svelte 5、TypeScript 6、Tailwind CSS 4 与 Material 3 Expressive。文章由 Markdown/MDX 驱动，Pagefind 提供静态全文搜索，Sharp 处理图片，Swup 提供页面切换，EdgeOne Pages 托管静态构建。

使用 Node.js 24 和 pnpm 11.25.0。主题源码基于上游提交 `616cbdfadd43bf11711f993fdb0b499196cd83bd`，保留本地页面调整与可关闭的悬浮文章目录。

采用双仓架构：本仓库存放主题代码和中性预览示例；个人文章、YAML 配置覆盖、数据和媒体由独立私有内容仓库提供。公开 CI 仅使用中性示例。许可证为 MIT，上游版权声明保留于 [LICENSE](LICENSE)。
