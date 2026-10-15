---
id: spliit-cloud-2-7-0
date: 2026-10-12
title: Quét hóa đơn nhanh hơn 5× — và nay đọc được cả PDF
channels: [updates, modal, email]
---

Spliit Cloud 2.7.0 cải tổ toàn diện tính năng quét hóa đơn: quét nhanh hơn khoảng 5×, danh mục gợi ý thông minh hơn, và hóa đơn không còn bắt buộc phải là ảnh chụp. Chi tiết có trong ghi chú [v2.7.0](https://github.com/antonio-ivanovski/spliit-cloud/releases/tag/v2.7.0).

## Quét nhanh hơn

Hóa đơn nay đi qua bước trích xuất văn bản riêng trước khi bất kỳ AI nào xem đến, nên một mô hình nhanh đảm nhận việc cấu trúc hóa thay vì để mô hình chậm đọc ảnh. Trong các lần chạy thử của chúng tôi, một hóa đơn 10 mục giảm từ khoảng 80 giây xuống còn khoảng 14 giây, và các hóa đơn nhỏ hơn thường xong trong khoảng 6 giây. Việc phân loại chuyển sang mô hình quyết định nhanh với toàn bộ lịch sử chi phí của bạn làm nền, nên gợi ý cũng sẽ chuẩn hơn.

## Không chỉ ảnh chụp

Bạn nay có thể quét hóa đơn PDF — hóa đơn số đọc trực tiếp, bản chụp ảnh tự động chuyển dự phòng — cùng các tệp TXT, CSV, DOCX và ODT. Số lượng mục cũng hỗ trợ phân số, nên dòng cân nặng như 1.5 kg sẽ đến đúng như in thay vì bị làm tròn mất.

## Bạn quyết định khi tổng không khớp

Khi các dòng mục quét được không cộng khớp với tổng hóa đơn, bản xem trước nay hỏi tổng nào mới đúng thay vì tự đoán. Chênh lệch làm tròn nhỏ sẽ gợi ý dòng "Làm tròn" với tổng hóa đơn được chọn sẵn; chênh lệch lớn hơn sẽ cảnh báo và gợi ý dòng "Khác" rõ ràng, và bạn luôn có thể sửa trong biểu mẫu chỉnh sửa.

## Hãy cho chúng tôi biết chỗ đọc sai

Quy trình mới này đã xử lý mọi lượt quét trên Spliit Cloud, nên hóa đơn của bạn chính là bộ kiểm thử thực tế. Nếu một lượt quét đọc sai mục, chọn nhầm danh mục hoặc cho tổng lạ, vui lòng [báo cáo](https://github.com/antonio-ivanovski/spliit-cloud/issues/new?template=bug_report.yml) kèm hóa đơn nếu bạn có thể chia sẻ.
