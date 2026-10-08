# Đăng bài theo chiến dịch với nút bật/tắt tự bấm Đăng

## Chuẩn bị và cập nhật tiện ích

1. Tạo nội dung và ảnh PNG, JPEG hoặc WebP; chọn các nhóm bạn có quyền đăng và đặt lịch/khoảng cách phù hợp. Không có giới hạn cứng ba nhóm.
2. Chạy `npm run extension:build`.
3. Mở `chrome://extensions`, chọn Reload tiện ích đã cài từ `extension/dist` (hoặc Load unpacked khi cài lần đầu).
4. Refresh các tab Facebook. Deploy web app không cập nhật extension unpacked.
5. Ghép nối bằng mã trong Cài đặt. Đăng nhập Facebook trực tiếp trên Chrome; không cung cấp mật khẩu/cookie cho Groupflow.

## Chạy và xác minh

1. Chọn chiến dịch, bấm **Bắt đầu chuẩn bị bài**.
2. Tiện ích mở nhóm đến hạn, điền caption, gắn ảnh và kiểm tra preview.
3. Chọn nút gạt **Tự động bấm Đăng** trước khi bắt đầu: mặc định tắt để bạn kiểm tra và tự bấm Đăng trên Facebook; bật để tiện ích tự bấm khi caption, ảnh và nút Đăng đã được xác minh. Để đổi chế độ, dừng theo dõi và xử lý bài đang chờ trước.
4. Chỉ tín hiệu xác nhận đăng đáng tin cậy mới ghi thành công và chuyển nhóm tiếp theo khi đến lịch.
5. Chờ quản trị viên duyệt, mất mạng hoặc kết quả chưa rõ: giữ tạm dừng, không bấm Đăng lần nữa. Chỉ chọn **Tôi xác nhận bài đã được đăng** sau khi kiểm tra bài thực tế trong nhóm.

## Dừng và phục hồi

- **Dừng theo dõi** dừng local monitoring; không hủy chiến dịch trên server.
- **Hủy chiến dịch** ngăn claim nhóm tiếp theo; không thu hồi bài Facebook đã nhận.
- **Reset nhóm lỗi** chỉ đặt FAILED về READY. Không reset POSTED, AWAITING_CONFIRMATION hoặc bài chờ duyệt.
- Reload tab/service worker khi có reservation: kiểm tra Facebook thủ công; tiện ích không tự gửi lại. Nếu chưa hề bấm Đăng nhưng đã reserve, giữ manual review thay vì tự reset.
- Upload thất bại có thể retry khi chắc chắn không có preview mới/tải đang chạy. Preview một phần, ảnh đã chỉnh sửa hoặc ảnh không nhận diện được: kiểm tra thủ công để tránh gắn trùng.
- Copy caption vẫn dùng được khi editor Facebook không giữ định dạng.

Các kiểm thử dùng Facebook DOM giả lập và popup/service worker extension thật. **LIVE FACEBOOK: NOT TESTED** trong lượt sửa này; không có bài đăng Facebook thật.

Preview ảnh được đối chiếu bằng bytes hoặc pixels đã giải mã, nên preview được mã hóa lại không còn bị từ chối chỉ vì bytes khác. Preview chuyển từ nguồn local đã khớp sang CDN trên cùng phần tử ảnh được hỗ trợ. Preview CDN không truy vết được, ảnh nén mất dữ liệu hoặc ảnh khác chưa đủ căn cứ vẫn cần kiểm tra thủ công. Khi tắt Auto, lỗi xác minh preview được hiển thị như nhắc kiểm tra; bạn tự xem caption/ảnh và bấm Đăng trên Facebook. Đừng tải thêm ảnh khi các ảnh đã hiện đủ. Build/reload extension và refresh tab Facebook sau khi cập nhật; thay đổi server cũng cần được triển khai để lưu nguồn click.
