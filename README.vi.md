<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a> |
  <a href="README.ja.md">日本語</a> |
  <strong>Tiếng Việt</strong>
</p>

<p align="center">
  <img src="src/assets/logo.png" width="112" alt="EvelProxyTool Logo">
</p>

<h1 align="center">EvelProxyTool</h1>

<p align="center">
  One Proxy. All Models. Any Platform.<br>
  Bảng điều khiển desktop di động cho CLIProxyAPI — mục tiêu của chúng tôi là làm cho token được tự do.
</p>

## Tổng quan

EvelProxyTool là công cụ quản lý desktop có giao diện đồ họa, xây dựng trên nền
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). Nó gộp việc quản lý vòng đời lõi (core),
xác thực OAuth, tổng hợp nhà cung cấp API, chuyển đổi giao thức, quản lý thông tin xác thực, kiểm tra
hạn mức, lịch sử sử dụng, bí danh mô hình và cấu hình agent client vào một giao diện duy nhất — để một
proxy cục bộ duy nhất có thể đứng trước Claude, Codex, Gemini và mọi công cụ agent/CLI nói được các API đó.

Ứng dụng được xây dựng bằng Tauri, React và Rust. Ứng dụng có thể mang theo gói lõi CLIProxyAPI tương
ứng, giúp việc cài đặt lần đầu và cài đặt offline dễ dàng hơn.

## Các tính năng chính

### Trang chủ và các URL API cục bộ

Trang chủ cho cái nhìn nhanh về trạng thái chạy của proxy cục bộ và các endpoint API sẵn sàng sử dụng:

- Khởi động, dừng, khởi động lại và làm mới lõi CLIProxyAPI.
- Xem trạng thái cài đặt, trạng thái chạy, PID tiến trình và cổng đang lắng nghe.
- Sao chép ngay các endpoint tương thích OpenAI, Claude, Gemini.
- Kiểm tra khả năng kết nối cục bộ và phiên bản ứng dụng/lõi chỉ trong một cái nhìn.

Việc cài đặt lõi, so sánh phiên bản và cài đặt offline được thực hiện ở trang **Quản lý phiên bản**.

### Xác thực tài khoản OAuth

Trang "Tài khoản" tập trung toàn bộ luồng xác thực qua trình duyệt cho các nhà cung cấp được hỗ trợ,
và liệt kê mọi thông tin xác thực đã đăng nhập trong một bảng phẳng duy nhất, với hạn mức, ngày hết hạn
và độ ưu tiên hiển thị ngay trong bảng:

- Codex OAuth
- Claude OAuth
- Antigravity OAuth
- Kimi OAuth
- xAI OAuth

EvelProxyTool mở trang xác thực trong trình duyệt và hỗ trợ hoàn tất luồng callback thủ công khi việc
chuyển hướng tự động không khả dụng, kèm theo tùy chọn tự động làm mới hạn mức theo chu kỳ.

### Tổng hợp nhà cung cấp API

Khu vực quản lý nhà cung cấp cho phép quản lý thông tin xác thực API và endpoint upstream theo giao
thức hoặc theo nhà cung cấp:

- Codex
- Nhà cung cấp tương thích OpenAI
- DeepSeek
- Claude
- Gemini

Bạn có thể thêm nhiều kết nối, tìm kiếm các mục hiện có, làm mới trạng thái nhà cung cấp, và sử dụng
chúng qua endpoint CLIProxyAPI cục bộ thống nhất. Request và response có thể được chuyển đổi qua lại
giữa các định dạng OpenAI, Claude, Gemini và các định dạng tương thích được hỗ trợ.

### Lịch sử sử dụng và phân tích token

Trang "Lịch sử sử dụng" giúp bạn hiểu hoạt động request cục bộ và mức tiêu thụ token:

- Xem tổng số request, số token, tỷ lệ thành công, thông lượng, tỷ lệ cache hit và chi phí ước tính.
- Lọc theo thời gian, mô hình, nhà cung cấp, nguồn, key và kết quả.
- Xem xu hướng request/token, cùng mức sử dụng input, output, reasoning và cache.
- Xem chi tiết request, các góc nhìn phân tích và thống kê giá.
- Thu thập qua kênh đăng ký sử dụng thời gian thực của CPA, với hộp thư cục bộ bền vững và cơ chế dự
  phòng HTTP tự động.
- Nâng cấp database lịch sử sử dụng cũ một lần khi khởi động, sau khi đã lưu bản sao lưu vào
  `usage-records/backups`.

### Cấu hình Agent client

Trang "Cấu hình Agent" phát hiện các client desktop và CLI đã cài đặt, và giúp kết nối chúng với proxy
cục bộ. Các client được hỗ trợ gồm:

- Claude Code
- Claude Desktop
- Codex
- OpenCode
- OpenClaw
- Hermes Agent
- Pi (kèm extension nhà cung cấp CLIProxyAPI)
- ZCode
- Kimi Code
- Grok Build

Với các client được hỗ trợ, ứng dụng có thể đồng bộ danh mục mô hình khả dụng, chọn mô hình mặc định,
sao lưu cấu hình gốc trước khi áp dụng cấu hình quản lý, và khôi phục lại cấu hình trước đó.

## Các khả năng khác

- Quản lý cấu hình lõi, API key, thông tin xác thực quản lý từ xa và chiến lược định tuyến.
- Tạo bí danh mô hình hiển thị cho client và ánh xạ tới mô hình của nhà cung cấp cùng mức suy luận.
- Tải lên, tải xuống, xem và quản lý tệp xác thực.
- Xem hạn mức nhà cung cấp và khả dụng của tài khoản.
- Giữ ứng dụng thường trực ở thanh menu macOS hoặc khay hệ thống Windows.
- Giao diện hỗ trợ Tiếng Việt, Tiếng Anh, Tiếng Trung giản thể và Tiếng Nhật.

## Bắt đầu nhanh

1. Tải gói phù hợp với hệ điều hành của bạn từ
   [GitHub Releases](https://github.com/evel2903/EvelProxyTool/releases/latest).
2. Giải nén gói Windows/Linux, hoặc mở file DMG trên macOS.
3. Khởi chạy EvelProxyTool.
4. Mở **Quản lý phiên bản** và cài đặt lõi CLIProxyAPI đi kèm hoặc phiên bản mới nhất.
5. Quay lại **Trang chủ**, khởi động lõi, rồi sao chép endpoint cục bộ cần dùng hoặc cấu hình nhà cung
   cấp OAuth/API.

## Cập nhật

Mỗi bản phát hành Windows đều xuất bản cả gói ZIP đầy đủ lẫn gói `update` ZIP kiểu cũ. Điều này giữ cho
tính năng cập nhật trong ứng dụng vẫn khả dụng với những client cũ chưa migrate, trong khi client mới
dùng gói đầy đủ để lõi đi kèm cũng được cập nhật.

Các gói phát hành hiện tại cho Windows, Linux và macOS đều hỗ trợ tự động cập nhật trong ứng dụng.
Linux thay thế các file ứng dụng portable trong khi vẫn giữ nguyên dữ liệu runtime, còn macOS thay thế
application bundle đã ký. Mỗi nền tảng đều chờ xác nhận phiên bản mới khởi động thành công và tự động
rollback nếu khởi động thất bại. Thư mục cài đặt cần có quyền ghi cho user hiện tại.

Các bản cài Linux/macOS hiện có cần một lần nâng cấp thủ công lên bản phát hành có kèm marker tự động
cập nhật đa nền tảng. Sau khi khởi chạy bản đó một lần, cập nhật trong ứng dụng sẽ khả dụng.

Nếu bạn đang dùng v0.2.5 trở về trước, hãy thực hiện một lần migrate thủ công: thoát EvelProxyTool, tải
gói ZIP Windows đầy đủ mới nhất cho đúng kiến trúc máy, rồi copy đè nội dung thư mục gốc của gói đó lên
thư mục cài đặt hiện tại. Đừng xóa thư mục hiện tại trước; dữ liệu người dùng như `config.toml`, `oauth`,
`cpa-core/config.yaml` sẽ được giữ nguyên vị trí. Sau khi khởi chạy phiên bản mới, các bản phát hành sau
đó có thể dùng cập nhật tự động trong ứng dụng.

## Nền tảng được hỗ trợ

GitHub Actions build các gói phát hành sau:

| Hệ điều hành | Kiến trúc | Gói |
| --- | --- | --- |
| Windows | amd64, aarch64 | ZIP |
| macOS | amd64, aarch64 | DMG |
| Linux | amd64, aarch64 | TAR.GZ |

## Dự án liên quan

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — lõi proxy được ứng dụng này quản lý.
- Dự án này ban đầu được fork từ [router-for-me/EasyCLIProxyAPI](https://github.com/router-for-me/EasyCLIProxyAPI);
  remote `upstream` vẫn trỏ về đó cho ai muốn theo dõi thay đổi từ upstream.
