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

Trong **Tài khoản → Đăng nhập bằng JSON**, bạn có thể dán nội dung hoặc chọn tệp JSON.

Chọn **Nền tảng** trước khi nhập. Codex (ChatGPT) hỗ trợ cả ba định dạng bên dưới; các nền tảng khác
dùng JSON xác thực CPA. **Tự nhận diện từ JSON** sử dụng nền tảng được khai báo trong tệp.

- **JSON phiên ChatGPT**: đăng nhập ChatGPT, mở `https://chatgpt.com/api/auth/session`, rồi dán JSON trả về để thêm tài khoản Codex.
- **JSON xác thực CPA**: nhập thông tin xác thực đã xuất từ CPA.
- **JSON xuất từ Sub2API**: tự tách các tài khoản OpenAI OAuth thành từng tệp xác thực Codex.

Lõi cần đang chạy để nhận tài khoản. Mỗi nội dung JSON tối đa 10 MiB; nếu một số tài khoản nhập thất bại,
nút thử lại chỉ gửi lại các tài khoản đó. JSON phiên ChatGPT chỉ dùng được khi token còn hiệu lực;
nếu không có refresh token, bạn cần nhập phiên mới khi token hết hạn.

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

Bản v0.2.29 sửa địa chỉ cập nhật sang repo `evel2903/EvelProxyTool` và hỗ trợ bản phát hành chỉ có
Windows amd64. Ứng dụng ưu tiên gói ZIP đầy đủ của đúng kiến trúc máy để cập nhật cả lõi đi kèm;
gói `update` ZIP kiểu cũ vẫn được hỗ trợ nếu bản phát hành chỉ có gói này. Một bản phát hành không cần
có đủ mọi kiến trúc, nhưng cần có gói phù hợp với máy đang cập nhật.

Bản phát hành hiện tại cung cấp gói **Windows amd64 (x64)**. Bộ cập nhật chờ ứng dụng mới xác nhận
khởi động ở bước thiết lập Tauri và tự động rollback nếu không nhận được xác nhận; đây chưa phải kiểm
tra toàn bộ giao diện hoặc sức khỏe lõi. Thư mục cài đặt cần có quyền ghi cho user hiện tại.

Mã nguồn có hỗ trợ Linux/macOS và aarch64, nhưng workflow hiện tại chưa phát hành gói cho các nền tảng
này. Tự cập nhật trên một nền tảng cần cả bản cài có marker `portable-app.json` hợp lệ và gói tương ứng
trong manifest phát hành.

Nếu bạn đang dùng **v0.2.28 trở về trước**, cần nâng cấp thủ công một lần lên **v0.2.29 hoặc mới hơn**,
vì bản cũ vẫn tìm cập nhật ở địa chỉ repo sai. Với Windows:

1. Dừng lõi, thoát EvelProxyTool cả ở khay hệ thống và sao lưu thư mục cài đặt hiện tại.
2. Tải gói ZIP đầy đủ đúng kiến trúc máy từ [GitHub Releases](https://github.com/evel2903/EvelProxyTool/releases/latest)
   rồi giải nén vào một thư mục riêng.
3. Chép `EvelProxyTool.exe`, `portable-app.json`, `core-version.txt` và tệp nén lõi đi kèm trong `cpa-core`
   từ gói mới vào đúng vị trí tương ứng trong thư mục cài đặt cũ. Chỉ thay các tệp phát hành này;
   không xóa thư mục cài đặt, không thay toàn bộ thư mục `cpa-core`.
4. Giữ nguyên cấu hình giao diện `config.toml`, thư mục tài khoản `oauth`, cấu hình lõi `cpa-core/config.yaml`
   và các dữ liệu runtime khác. Không chép đè các tệp cấu hình đang dùng bằng tệp mẫu.
5. Khởi chạy `EvelProxyTool.exe` tại thư mục cài đặt cũ và kiểm tra tài khoản, cấu hình. Những bản phát hành
   tiếp theo có thể dùng cập nhật trong ứng dụng.

## Nền tảng được hỗ trợ

GitHub Actions hiện build gói phát hành sau:

| Hệ điều hành | Kiến trúc | Gói |
| --- | --- | --- |
| Windows | amd64 (x64) | ZIP đầy đủ và ZIP cập nhật |

## Dự án liên quan

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) — lõi proxy được ứng dụng này quản lý.
- Dự án này ban đầu được fork từ [router-for-me/EasyCLIProxyAPI](https://github.com/router-for-me/EasyCLIProxyAPI);
  remote `upstream` vẫn trỏ về đó cho ai muốn theo dõi thay đổi từ upstream.
