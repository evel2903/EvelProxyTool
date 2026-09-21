# Kế hoạch sửa Antigravity desktop qua CPA

Trạng thái 2026-09-21: đã tích hợp vào app và xác minh desktop → CPA thực tế.

Antigravity 2.15.1 trên Windows đã trả lời `CPA_DESKTOP_OK` từ giao diện native.
Log desktop ghi nhận streaming qua cầu nối loopback; cơ sở dữ liệu usage của
CPA ghi hai yêu cầu thành công lúc 19:30:40 (+07:00), đúng model
`gemini-3.8-flash-high`, bằng hai `auth_index` khác nhau. Tài khoản đăng nhập
desktop được giữ nguyên. Không cần cài CLI hoặc sửa ứng dụng đã cài.

Bước 1–4 đã có triển khai và bằng chứng runtime. Bước 5 đã build và chạy lại app,
thử Restore → Apply → Launch và tool call đọc fixture thành công. Tổng cộng 5
yêu cầu thành công dùng 5 tài khoản khác nhau. Xem [báo cáo debug](antigravity-debug-status.md)
để phân biệt các kiểm thử thực tế với kiểm thử mô phỏng và giới hạn còn lại.

## Mục tiêu và phạm vi

Trên Windows, người dùng chọn model trong EvelProxyTool, áp dụng cấu hình và mở
Antigravity desktop. Yêu cầu suy luận từ desktop phải đi qua CPA; CPA chọn tài
khoản upstream theo chính sách routing hiện có. Đổi tài khoản ở CPA không đồng
nghĩa với đổi tài khoản đăng nhập hiển thị trong Antigravity.

Không yêu cầu cài standalone CLI để hoàn thành mục tiêu desktop. Phiên bản thử
nghiệm đầu tiên là desktop 2.15.1 đang có trên máy. Các bản khác chỉ được công bố
hỗ trợ khi đã kiểm tra khả năng tương thích.

## Căn cứ ban đầu trước khi triển khai

- CPA đã trả lời một yêu cầu Gemini thật; chưa chứng minh streaming, tool calls
  hoặc xoay nhiều tài khoản từ desktop.
- Desktop tự tạo lệnh chạy language server; trường `evelProxyTool` đang ghi vào
  config không được bộ khởi chạy này sử dụng.
- Backend có cờ chọn Gemini và model cùng các symbol xác thực bằng API key.
  Chưa biết cách desktop chọn đúng cơ chế này.
- Probe riêng chỉ bật Gemini/model vẫn đi vào OAuth; chưa kiểm chứng probe có
  endpoint/key CPA vì lệnh đó bị hệ thống duyệt tự động chặn.

Chi tiết bằng chứng nằm trong [báo cáo debug](antigravity-debug-status.md).

## 1. Chốt đường tích hợp desktop bằng thử nghiệm tối thiểu

Đọc luồng khởi tạo backend và xác thực để xác định đầu vào thực sự điều khiển
provider, endpoint và model. Ưu tiên cơ chế cấu hình/khởi chạy mà desktop hỗ trợ.
Giả thuyết cần kiểm chứng là backend dùng Gemini API client và gửi tới CPA.
Sự xuất hiện của tên biến trong binary không đủ để kết luận cơ chế hoạt động.

Khi có thể thực hiện thử nghiệm hợp lệ, dùng profile riêng, endpoint loopback,
xác thực và CSRF được giữ nguyên. Gửi một prompt vô hại từ chính giao diện
desktop và đối chiếu thời gian/model/request với bản ghi CPA. Kiểm tra model
thực sự được gửi, không chỉ model đã lưu ở EvelProxyTool.

Điều kiện qua bước: giao diện desktop hiển thị câu trả lời hoàn chỉnh và CPA
ghi nhận đúng yêu cầu đó. Nếu không đạt, lưu lỗi và xác định chính xác phần
không tương thích trước khi xây tích hợp sản phẩm. Không coi chạy riêng backend
hoặc gọi trực tiếp CPA là bằng chứng desktop hoạt động.

## 2. Xây phần cấu hình và khởi chạy riêng cho desktop

Chỉ thực hiện sau khi bước 1 chứng minh được đường tích hợp.

- `agents/discovery.rs`: nhận diện desktop, phiên bản và khả năng tích hợp độc
  lập với CLI; cung cấp launch target desktop khi có cơ chế đã kiểm chứng.
- `agents/configuration.rs` và `agents/state.rs`: lưu đúng dữ liệu được cơ chế
  tích hợp sử dụng; sao lưu và khôi phục riêng phần do công cụ quản lý, giữ các
  thay đổi tùy chọn của người dùng. Di chuyển marker cũ mà không coi nó là bằng
  chứng đã kết nối.
- `agents/launch.rs`: truyền endpoint, key và model qua đầu vào đã xác minh;
  xử lý trường hợp app đã chạy để tránh tái sử dụng tiến trình với cấu hình cũ.
  Không đóng phiên desktop đang có công việc chưa lưu một cách âm thầm.
- Tách phần tích hợp desktop thành module riêng nếu cần, để logic nhận diện,
  cấu hình và khởi chạy có thể kiểm tra độc lập.

Không đưa key vào thông báo lỗi/log. Khi phiên bản app không tương thích, báo
lỗi rõ ràng và cho phép khôi phục. Chưa chọn sửa `app.asar` làm giải pháp: cần
đánh giá tính cần thiết, cập nhật ứng dụng và khả năng phục hồi bằng bằng chứng
riêng; không dùng sửa archive để vòng qua lệnh chạy thử đã bị chặn.

## 3. Sửa trạng thái và thao tác trong EvelProxyTool

Ở `AgentsPage.tsx`, `agentConfigurationDraft.ts` và các bản dịch:

- Bỏ điều kiện bắt buộc có launch target CLI đối với tích hợp desktop.
- Phân biệt đã phát hiện app, đã lưu cấu hình và đã kiểm chứng kết nối.
- Chỉ bật Apply/Launch khi phần tích hợp desktop đáp ứng điều kiện cần thiết;
  thiếu CLI không phải lỗi của desktop.
- Hiển thị model/endpoint đang áp dụng, lỗi có hành động xử lý cụ thể, và cách
  khôi phục cấu hình mặc định. Không hiển thị key.

## 4. Xác minh xoay tài khoản tại CPA

Dùng routing hiện có trong `core_config`, không xây thêm bộ xoay ở desktop.
Kiểm tra số tài khoản đủ điều kiện cho model và ảnh hưởng của session affinity.
Đọc các bản ghi usage có `auth_index` để đối chiếu lựa chọn tài khoản; trong báo
cáo người dùng dùng định danh ẩn danh.

Với ít nhất hai tài khoản hợp lệ, gửi một chuỗi yêu cầu từ desktop phù hợp với
chính sách routing và xác nhận có ít nhất hai tài khoản được chọn. Nếu giữ
session affinity, dùng các phiên độc lập khi cần; không mặc định từng tin nhắn
trong một cuộc hội thoại phải đổi tài khoản.

Kiểm tra failover bằng lỗi mô phỏng có kiểm soát; không cố tiêu hao quota thật.
Nếu chỉ có một tài khoản đủ điều kiện, báo rõ chưa thể nghiệm thu xoay thực tế.

## 5. Kiểm thử và bàn giao

- Regression: nhận diện desktop không cần CLI; cấu hình lỗi không mất dữ liệu;
  restore giữ tùy chọn người dùng; app không tương thích báo đúng trạng thái;
  tham số khởi chạy nhận đúng model và endpoint.
- End-to-end: trả lời thường, streaming, hủy phản hồi, một tool call vô hại,
  đổi model nếu có model thứ hai, mở lại app, CPA không chạy và key không hợp lệ.
- Rotation: bằng chứng yêu cầu từ desktop được CPA xử lý bằng nhiều tài khoản;
  kiểm tra lỗi/failover tách biệt với thành công của một yêu cầu đơn lẻ.
- Chạy Rust tests liên quan, TypeScript check và build. Ghi riêng lỗi baseline
  Codex catalog đã biết nếu vẫn tái hiện; không công bố toàn bộ suite pass.
- Chạy bản EvelProxyTool vừa build, kiểm tra luồng Apply → Launch → phản hồi và
  Restore. Bàn giao bản build cùng phiên bản desktop đã thử và giới hạn còn lại.

Nghiệm thu khi desktop thật đi qua CPA, các luồng trên đạt, khôi phục được cấu
hình và có bằng chứng xoay nhiều tài khoản. Một marker `configured=true` không
đáp ứng điều kiện nghiệm thu.

## Quyết định triển khai

Giữ nguyên OAuth native cho các thao tác tài khoản; launcher chỉ truyền
`CLOUD_CODE_URL` tới cầu nối nội bộ. Key CPA nằm trong cầu nối, không truyền vào
backend native. Cầu nối chuyển riêng suy luận sang Gemini API của CPA, còn các
route điều khiển nằm trong danh sách cho phép vẫn dùng OAuth tới Google.
Đây là đường đã được kiểm chứng từ giao diện desktop thực tế; thử nghiệm
API-key/CLI trước đây không được sử dụng làm tích hợp sản phẩm.
