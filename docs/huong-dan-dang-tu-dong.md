# Đăng tự động tối đa 3 nhóm

## Chuẩn bị

1. Trong ứng dụng, vào Nội dung, tạo bài viết và tải ảnh PNG, JPG hoặc WebP lên.
2. Vào Chiến dịch, chọn bài viết đó và chọn từ 1 đến 3 nhóm bạn muốn đăng. Đặt khoảng cách giữa các bài rồi tạo chiến dịch.
3. Mở `chrome://extensions`. Bật Developer mode. Nếu chưa cài tiện ích, chọn Load unpacked và chọn thư mục `D:\code\fb-group\extension\dist`.
4. Nếu đã cài, bấm Reload của tiện ích. Bản mới cần quyền `alarms` để chạy lịch. Tải lại các tab Facebook đang mở.
5. Vào Cài đặt trong ứng dụng, tạo mã ghép nối. Mở tiện ích, nhập địa chỉ ứng dụng và mã. Khi chạy trên máy, dùng `http://localhost:3000`.
6. Đăng nhập Facebook trực tiếp trong Chrome và giữ Chrome mở trong lúc chạy.

## Bắt đầu

1. Chọn Tiếng Việt trong tiện ích.
2. Bấm **Tải lại chiến dịch** và chọn chiến dịch vừa tạo.
3. Bấm **Bắt đầu đăng tự động**.

Tiện ích mở nhóm đến hạn, điền nội dung, gắn ảnh, chờ tải ảnh và bấm Đăng. Khi thấy thông báo xác nhận đăng mới, tiện ích ghi lịch sử rồi chờ nhóm kế tiếp. Lịch được kiểm tra khoảng mỗi phút, nên thời điểm thực tế có thể muộn hơn thời điểm đã đặt.

Mỗi chiến dịch tự động chỉ được chọn tối đa 3 nhóm. Mỗi lượt cũng dừng sau tối đa 3 lần gửi yêu cầu đăng.

## Khi cần dừng hoặc xử lý lỗi

- Bấm **Dừng đăng tự động** để ngừng các lần đăng tiếp theo. Nút này không thu hồi bài đã gửi.
- Nếu Facebook yêu cầu đăng nhập hoặc xác minh, thực hiện trực tiếp trên Facebook.
- Nếu ảnh không tải xong, không tìm được nút Đăng, bài chờ quản trị viên duyệt hoặc chưa xác định được kết quả, tiện ích dừng để bạn kiểm tra.
- Với lần đăng chưa rõ kết quả, kiểm tra nhóm trước khi dùng **Tôi đã đăng bài**, **Bỏ qua nhóm** hoặc **Báo lỗi**. Tiện ích giữ bài đó và không tự bấm Đăng lại.
- Nếu chiến dịch đang tạm dừng, tiếp tục chiến dịch trong ứng dụng trước khi bắt đầu lại ở tiện ích.

Các kiểm thử tự động dùng trang Facebook giả lập. Giao diện Facebook thật vẫn cần kiểm tra trực tiếp vì vị trí và nhãn của các điều khiển có thể khác.
