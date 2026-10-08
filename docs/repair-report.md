# Báo cáo sửa assisted workflow — 08/10/2026

## 1. Baseline

- Đã đọc toàn bộ FB_GRP_REPAIR_INSTRUCTIONS.md trong Downloads và AGENTS.md; đã đọc các tài liệu kiến trúc, extension, workflow, security, hướng dẫn tiếng Việt và guide route handler Next.js 16.4 cài trong node_modules.
- HEAD: 7e30328f1875ea1bc0ea71fedd1d884ccd5817c0, đúng mốc tham chiếu; nhánh ban đầu main, nhánh làm việc codex/repair-assisted-workflow.
- Repo ban đầu có 7 file modified và hai đường dẫn untracked. Giữ lại thay đổi của người dùng, không reset/ghi đè checkout. Không commit, push, merge, deploy hoặc migration production.
- Baseline npm run test: exit 1, 63 pass / 4 fail trong 67 tests. Lỗi tái hiện: publication callback không tiếp tục queue, preference callback timeout hai case, lỗi ghi history mất thông báo nguyên nhân.
- Rescan phát hiện AUTO_SET_PUBLISH nằm trong hàm không có message/sendResponse trong scope; nhánh autoPublish vẫn có thể tự bấm Post; caption validator bỏ toàn bộ whitespace; failed/skip còn nhận AWAITING_CONFIRMATION.

## 2. File đã sửa

| File | Mục đích |
| --- | --- |
| extension/src/content/index.ts | Logical caption/line breaks, giữ human edits; decode ảnh và hash preview local; partial/changed preview không upload trùng; cancellation generation; trusted click; observer thông báo; watcher identity qua PING |
| extension/src/content/post-outcome.ts | Phân loại published/approval/unknown/failure/login/checkpoint, tín hiệu mâu thuẫn giữ unknown |
| extension/src/background/index.ts | Assisted mode bỏ auto-click preference; durable actual-click flag/audit; chặn prepare lại job reserved; confirmation lock; recovery khi watcher/worker mất; errorCode |
| extension/src/popup/main.ts, extension/src/popup/index.html | Bỏ switch auto-click; xác nhận thủ công có nhắc kiểm tra Facebook; khóa skip/failed cho uncertain; nhãn completed và mã lỗi Advanced |
| src/app/api/extension/jobs/[id]/submission/route.ts | Audit actual click idempotent; click đã ghi chặn release reservation |
| src/app/api/extension/jobs/[id]/posted/route.ts | Audit confirmationSource ui_confirmed/user_confirmed; validate UUID |
| src/app/api/extension/jobs/[id]/failed/route.ts, skip/route.ts | Chỉ nhận OPENED; không biến unknown thành FAILED/SKIPPED; validate UUID |
| src/lib/services/queue-state-machine.ts | AWAITING_CONFIRMATION chỉ chuyển POSTED sau xác nhận |
| src/lib/i18n/messages.ts | Thêm thông báo recovery/click/upload tiếng Việt; giữ các thay đổi cũ |
| tests/extension-background.test.ts, tests/security-core.test.ts | Legacy preference, uncertain prepare/restart, queue transition, callback failure |
| tests/extension-api.test.ts | Route tests trên PostgreSQL PGlite dùng bộ nhớ riêng, migrations chỉ chạy trên instance đó |
| tests/post-outcome.test.ts | Classifier conservative và tín hiệu mâu thuẫn |
| e2e/facebook-adapter.spec.ts | Caption/Unicode/Lexical, retry upload, partial/changed previews, trusted/synthetic click, old/feed/conflicting notices |
| e2e/automatic-extension.spec.ts | Popup và service worker unpacked thực; legacy preferences false/true, mỗi chiến dịch bốn nhóm giả lập; capture completed/paused |
| e2e/live-workflow.spec.ts | Đồng bộ fixture PNG hợp lệ và dialog xác nhận mới; live suite chưa chạy |
| .github/workflows/validate-extension.yml | Thêm lint, triggers services/schema/validators/campaigns/config và popup extension regression |
| README.md; docs/extension.md, workflow.md, security.md, huong-dan-dang-tu-dong.md, verification.md, chrome-web-store.md | Đồng bộ assisted mode, không cap ba nhóm, Stop/Cancel/Reset, build/reload và phân biệt báo cáo lịch sử |
| docs/repair-evidence/*.png | Bằng chứng UI giả lập, không có dữ liệu người dùng thật |

## 3. Bug, nguyên nhân và regression

- Callback success tham chiếu biến ngoài scope: bỏ đoạn preference handler sai chỗ. Legacy setting không thể kích hoạt auto-click trong campaign. Test cả false và true, đi qua bốn nhóm bằng click giả lập trusted của Playwright.
- Cache upload lỗi đã có một phần sửa trong working tree: giữ phần đó và bổ sung decode/loaded preview, hash bytes khớp từng requested file, cache chỉ xác nhận sau thành công. Fail lần đầu -> retry thành công -> repeat không thêm ảnh. Preview thiếu/một phần/đã chỉnh sửa -> pause, không dispatch upload lại.
- Validator bỏ whitespace: thay bằng logical DOM reader cho textarea, p/div/br; normalize CRLF/Unicode separators/NFC/NBSP nhưng không xóa khoảng trắng giữa từ hay ZWJ. Test missing spaces/lines, double blanks, paste reconciliation và human edits.
- Toast quá rộng và watcher callback chậm: observer bắt đầu ngay tại trusted click trước API round trip; bỏ notices trong feed/article và notice cũ; match publication phrases chặt, tín hiệu mâu thuẫn unknown. Click không phải published.
- Reservation bị xem như click và release sau click: userClicked durable riêng + QUEUE_ITEM_USER_CLICKED audit; release bị từ chối khi đã có audit click; callback click lặp không nhân audit.
- Unknown có thể FAILED/SKIPPED rồi reset: routes/state machine chặn; reset chỉ FAILED, CANCELLED không reopen. Test route thực, workspace/claim isolation, concurrent confirms và stale uncertain không reclaim.
- Worker/tab restart: mất watcher -> pause/manual review, không tự refill hay gửi lại. Generation giữ cancellation của tác vụ cũ ngay cả khi job được unlock cho lần chuẩn bị mới.

## 4. Lệnh và kết quả thực tế

| Lệnh | Exit | Kết quả |
| --- | --- | --- |
| npm ci | 1 | Windows EPERM khi unlink native lightningcss đang được dùng |
| npm install --ignore-scripts | 0 | Khôi phục dependencies; warning cleanup native files bị khóa, lockfile không đổi |
| npm --prefix extension ci | 0 | Cài dependencies extension |
| npm run typecheck | 0 | Pass vòng cuối |
| npm run lint | 0 | Pass vòng cuối, không warning |
| npm run test | 0 | 86 passed, 7 files |
| npm run extension:build | 0 | TypeScript + Vite pass; extension/dist đã build |
| npx playwright install chromium | 0 | Đã chạy, Chromium sẵn sàng |
| npx playwright test e2e/facebook-adapter.spec.ts e2e/automatic-extension.spec.ts --workers=1 | 0 | 46 passed ở vòng xác minh hash preview |
| npx playwright test e2e/facebook-adapter.spec.ts -g 'partial previews' --workers=1 | 0 | 1 passed; case thêm sau khi lượt 46 tests đã discover |
| npx playwright test e2e/auth-pages.spec.ts e2e/language.spec.ts --workers=1 | 0 | 3 passed |
| npx playwright test e2e/automatic-extension.spec.ts --workers=1 | 0 | 2 passed lượt cuối, capture screenshots completed/paused |
| npm run build | 0 | Next.js 16.4 production build pass, 35 static-page tasks |
| git diff --check | 0 | Không lỗi whitespace |
| npm run test:acceptance | Không chạy | Chưa xác minh .env.local trỏ DB test riêng; không chạy migrations/seed/cleanup trên DB có thể là production |

Các vòng trung gian được sửa rồi chạy lại: build đầu lỗi nullable preparedJob; lint đầu thấy script patch tạm (đã xóa); fixture PNG cũ hỏng; fixture đếm audit click thành reservation; một case caption timeout khi chạy đồng thời, không tái hiện khi chạy tuần tự. Không tính các vòng lỗi thành pass.

API tests mock device authentication nhưng chạy query/transaction thật trên PGlite. Concurrent tests là concurrent route calls trong DB test; chưa thay thế kiểm chứng hai thiết bị trên production PostgreSQL/Chrome thật.

## 5. Computer Use và bằng chứng

Computer Use đã thử qua cua.getState; Node REPL/browser runtime không khởi động được: windows sandbox helper_unknown_error: setup refresh had errors. Terminal sandbox cũng lỗi; các lệnh đọc/sửa/test chạy qua escalation được chấp thuận. Không kiểm soát được desktop Chrome/profile người dùng trong lượt này.

Playwright đã tương tác popup extension unpacked và service worker thực, composer/ảnh/notice/điều hướng Facebook-like DOM được route.fulfill hoàn toàn. Click Post chỉ diễn ra trên fixture. Public app UI: login/register và đổi ngôn ngữ EN/VI. Đã xem screenshot popup hoàn tất; screenshot chỉ chứa dữ liệu giả nên không có PII cần làm mờ.

- [Popup completed](repair-evidence/popup-completed.png)
- [Popup paused](repair-evidence/popup-paused.png)
- [Composer giả lập](repair-evidence/composer.png)

**LIVE FACEBOOK: NOT TESTED. Không có bài đăng Facebook thật.**

## 6. Rủi ro và phần chưa kiểm chứng

- DOM/phrases thực tế Facebook có thể khác fixture. Selector scope và thông báo published mới vẫn cần manual QA trong một nhóm người dùng có quyền đăng.
- Ảnh thumbnail bị Facebook biến đổi hoặc chỉ có CDN preview không khớp bytes local: dừng để người dùng kiểm tra. Không tự coi count img là chứng cứ.
- Không lấy permalink nếu thiếu chứng cứ tin cậy, không tạo URL giả; URL để trống trong flow hiện tại.
- Chỉ có reservation nhưng chưa click mà reload mất watcher: vẫn giữ manual review; không có auto-release vì không đủ bằng chứng chưa gửi.
- PostgreSQL production, Facebook thật, Netlify và DB live acceptance chưa được kiểm chứng. Các quy tắc Facebook, lịch và quyền đăng của từng nhóm vẫn phải được tôn trọng.
- Advanced manual publishing hiện hữu được giữ; assisted campaign không dùng synthetic Post. Không có bypass checkpoint/CAPTCHA hoặc thu thập session.

## 7. Cách dùng

1. npm run extension:build -> chrome://extensions -> Reload tiện ích từ extension/dist -> refresh tab Facebook.
2. Chọn một nhóm thử nghiệm có quyền đăng. Kiểm tra caption/ảnh; tự bấm Đăng nếu muốn thử thật. Agent chưa thực hiện thử nghiệm này.
3. Chờ xác minh. Unknown/approval: không đăng lại; chỉ Confirm published sau khi nhìn thấy bài thực tế đã published.
4. Reset chỉ các nhóm FAILED, không reset AWAITING_CONFIRMATION/POSTED. Stop monitoring và Cancel campaign khác nhau; không thu hồi bài đã gửi.
5. Deploy server không cập nhật extension unpacked. Không có giới hạn cứng ba nhóm; vẫn tuân lịch, khoảng cách đăng và quy định nhóm.

## Content library follow-up (2026-10-08)

Baseline remains `7e30328` on `codex/repair-assisted-workflow`. Existing uncommitted repairs were preserved. The content library previously initialized its media map to empty and displayed all captions/actions inline; saved images disappeared from the visible metadata after reloading, and attaching an image used only the first selected file.

Changed `src/app/(app)/content/page.tsx` and added `src/lib/services/content-library.ts` to fetch saved image metadata for displayed content in one workspace-scoped query. Updated `src/components/workspace-panel.tsx` to show persistent image counts, one Details disclosure per content, authenticated thumbnails, multiple-image uploads, remaining-file retry and upload locking. The count changes only after successful API responses. Updated Vietnamese messages, workflow documentation and CI coverage. Existing architecture and working content actions remain in place.

Validation: `npm run test` passed 98 tests across 7 files, including 2 new saved-media persistence/isolation tests. `npx playwright test e2e/content-library.spec.ts e2e/campaign-delete.spec.ts` passed 12 cases (7 content, 5 deletion). Typecheck, lint and production build passed. Content browser tests use the actual React component and real application CSS with controlled API responses; they do not claim authenticated production upload coverage. Desktop/mobile screenshots use synthetic fixture content: `docs/repair-evidence/content-details-desktop.png` and `docs/repair-evidence/content-details-mobile.png`.

Computer Use attempted `cua.getState()` but returned `trusted Node process exited unexpectedly`. Playwright verified the content interface instead. LIVE FACEBOOK: NOT TESTED; no Facebook posts, existing campaigns or real user content were changed. No schema migration, push or deployment was performed.

Use: reload the local Content page, check the image count beside a saved item's name, click Details to inspect its caption and thumbnails, and choose multiple images. If uploading stops midway, Retry remaining images resumes the remaining selection. A page reload displays successfully saved images but cannot preserve unsaved browser File selections.

## Image deletion and inline editing follow-up

Added workspace/session/Origin-scoped DELETE to `src/app/api/media/[id]/route.ts`, including UUID validation, a locked metadata transaction and storage-failure retry. `src/lib/storage/index.ts` now reports actual local file deletion failures while treating an already missing file as removable. The content card includes per-thumbnail Delete image with a filename confirmation; previews and counts update only after API success. `ContentEditor` now renders inside its content card, preserves failed drafts, and updates the card after saving. Request locks prevent conflicting content/media operations. Vietnamese messages, workflow documentation and CI path coverage were updated.

Verification: 103 unit/API tests passed, including deletion isolation, invalid Origin/ID, failed storage/retry, persistent counts and image preservation during content edits. 16 Playwright cases passed across content-library (11) and campaign-delete (5); content cases include confirmation cancellation, deletion failure/retry, inline save/cancel/error, and desktop/mobile layout with real application CSS. Typecheck, lint and production build passed. Visual evidence: `docs/repair-evidence/content-inline-editor-mobile.png`. All deletion tests used synthetic fixture media or isolated PGlite data; no actual user images or Facebook posts were deleted. The previously recorded Computer Use runtime limitation remains.

## Management editor placement follow-up

Moved the Groups page editor from the page top to a table row directly below the selected group. Kept the campaign editor inside Campaign settings and moved each campaign group's edit form into its own row; the new-group form sits below its Add control. Content and variant editing already render within their selected content. Field IDs, API calls and saved data semantics remain unchanged. Added `e2e/inline-management.spec.ts` and CI coverage for placement, save, switching selection, failed draft preservation and campaign group placement. Screenshot uses synthetic data: `docs/repair-evidence/group-inline-editor.png`.

Final validation for this placement change: typecheck, lint and production build passed; 15 Playwright tests passed (4 inline-management and 11 content-library). The new UI was verified with controlled browser fixtures, not authenticated production data. The prior Computer Use runtime limitation remains; no public Facebook posts or deployments were performed.
