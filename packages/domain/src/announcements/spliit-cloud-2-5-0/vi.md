---
id: spliit-cloud-2-5-0
date: 2026-10-05
title: Spliit Cloud 2.5.0 đã ra mắt
inApp: true
email: true
---

Spliit Cloud 2.5.0 đã phát hành. Dưới đây là những điểm mới trong phiên bản này, cùng tổng hợp các tính năng gần đây mà bạn có thể đã bỏ lỡ. Chúng tôi sẽ chỉ chia sẻ tính năng mới và thông báo quan trọng theo cách này — chứ không phải các bản vá nhỏ và bản sửa lỗi được phát hành thường xuyên.

## Tab Hoạt động nay dành riêng cho bạn

Tab Hoạt động nay giống với dòng thời gian chi phí: công tắc Dành cho bạn / Tất cả ẩn các hoạt động không liên quan đến bạn sau các hàng nội tuyến, và mỗi chi phí hiển thị phần của bạn trên dòng Phần của bạn: riêng. Chi tiết có trong ghi chú [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0).

## Xóa tài khoản của bạn, với lưới an toàn 48 giờ

Cài đặt tài khoản có Khu vực nguy hiểm mới với trang xem lại chuyên biệt: xem hậu quả theo từng nhóm, chọn cách xử lý tên và số dư còn lại của bạn, rồi nhập XÓA để lên lịch. Tài khoản của bạn vẫn hoạt động trong 48 giờ và bạn có thể hủy bất cứ lúc nào. Chi tiết có trong ghi chú [v2.5.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.5.0).

## Phân loại nhanh hơn nhiều, cùng dọn dẹp hàng loạt từ Công cụ nhóm

Các chi phí nay được phân loại trong khoảng 250ms bằng mô hình quyết định Jev thay vì khoảng 3s bằng LLM, và các dự đoán chưa chắc chắn hiển thị dưới dạng gợi ý chạm một lần. Khi cả nhóm cần dọn dẹp, tính năng [phân loại hàng loạt](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) giúp xem lại các gợi ý và lưu cùng lúc từ Công cụ nhóm. Chi tiết có trong ghi chú [v2.4.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.0) và [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0).

## Nhập từ hầu hết mọi CSV ngân hàng hoặc thẻ

Mang theo các khoản chi tiêu hiện có bằng cách tải lên sao kê ngân hàng hoặc file xuất thẻ. [Trình nhập CSV chung](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0) ánh xạ cột với bản xem trước trực tiếp, ánh xạ danh mục, và đánh dấu trùng lặp trước khi ghi bất cứ thứ gì.

## Khóa truy cập cho mọi tài khoản, kể cả khách

Đăng nhập bằng vân tay, khuôn mặt hoặc khóa bảo mật thay vì mật khẩu. Khóa truy cập hoạt động cho tài khoản email, mạng xã hội và tài khoản khách, đồng thời kết hợp tốt với tài khoản ẩn danh để thay thế liên kết khôi phục. Xem ghi chú [v2.3.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.3.0).

## Mời cả phòng trong vài giây

Chia sẻ một mã QR chỉ quét mà cả phòng đều có thể dùng, có hiệu lực trong 15 phút kèm danh sách trực tiếp những người đã tham gia. Khách cũng có thể tham gia từ camera điện thoại hoặc thao tác Quét để tham gia. Xem ghi chú [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0).

## Ứng dụng gọn gàng hơn, hiển thị những gì thuộc về bạn

Dòng thời gian nay ẩn các chi phí và hoạt động không liên quan đến bạn sau các hàng nội tuyến, với công tắc Dành cho bạn / Tất cả. Bạn cũng có thể tự sắp xếp thứ tự tab nhóm và ẩn các tab không dùng, xem bảng kê chi tiết theo từng người trong chi tiết chi phí, và chọn giờ trên di động bằng vòng cuộn lớn. Xem ghi chú [v2.1.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.1.0) và [v2.4.1](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.4.1).

## Mang theo dữ liệu của bạn

Xuất bản sao lưu ZIP khứ hồi đầy đủ của các nhóm và tài khoản, cùng báo cáo CSV và PDF để in. Nhập và xuất được trình bày trong ghi chú [v2.0.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.0.0).

## Giúp mỗi nhóm dễ nhận biết

Tạo diện mạo riêng cho mỗi nhóm bằng biểu tượng cảm xúc và màu sắc, hiển thị trên thẻ, thanh và nền xung quanh. Xem ghi chú [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0).

## Dành cho nhà phát triển: webhook chiều đi

Đẩy các sự kiện tạo, cập nhật và xóa chi phí tới điểm cuối HTTPS của riêng bạn dưới dạng sự kiện đã ký, kèm thử lại, lịch sử gửi và gửi lại. Cách thiết lập có trong ghi chú [v2.2.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.2.0).
