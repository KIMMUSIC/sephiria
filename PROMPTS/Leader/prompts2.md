# Role Upgrade
당신은 `OpenCV.js`를 활용한 컴퓨터 비전 전문가입니다.
유저가 전체 화면 스크린샷이나 임의로 대충 자른 이미지를 붙여넣었을 때, 수동 크롭 조작 없이 **알고리즘이 인벤토리 영역을 자동으로 추적하여 파싱하는 'Auto-Grid Detection' 파이프라인**을 구현하세요.

# Context & Challenge
- 유저마다 스크린샷의 해상도(UI 스케일)가 다릅니다.
- 세피리아의 인벤토리는 고정된 사각형이 아니라, 진행에 따라 십자가 모양 등 불규칙하게 확장되는 **비정형 그리드**입니다. 따라서 전체 Bounding Box 하나를 찾는 방식(Slicing)은 통하지 않으며, **개별 칸(Cell) 단위의 인식과 군집화**가 필요합니다.

# Task 1: Auto-Grid Detection Algorithm (`workers/vision.worker.ts`)
- 유저가 `Ctrl+V`로 이미지를 붙여넣으면 무거운 연산 방지를 위해 Worker 내에서 다음을 실행하세요.
  1. **Edge Detection**: `cv.cvtColor` (Grayscale) 및 `cv.Canny` (또는 `cv.adaptiveThreshold`) 처리 후, `cv.findContours`와 `cv.approxPolyDP`를 사용하여 도형의 윤곽선을 찾습니다.
  2. **Square Filtering**: 꼭짓점이 4개이고, 가로세로 비율(Aspect Ratio)이 약 0.9~1.1 사이인 **'정사각형'** 윤곽선만 필터링합니다. 노이즈를 없애기 위해 사각형 크기(Area)의 중간값(Median)을 구해 너무 작거나 큰 사각형은 버립니다.
  3. **Grid Clustering**: 필터링된 사각형들의 중심점(Center X, Y) 좌표를 분석하여, "서로 일정한 간격(Grid Step)으로 인접해 있는 사각형들의 거대한 군집(Cluster)"을 수학적으로 찾아내세요. 이 군집이 바로 비정형 인벤토리 칸들입니다.
  4. 군집화된 개별 칸들의 중심점 좌표와 크기를 배열로 도출하여 원본 이미지에서 하나씩 Crop(잘라내기) 하세요.

# Task 2: Match & Parse
- Task 1에서 잘라낸 개별 Cell 이미지들을 정규 크기(예: 64x64)로 리사이징합니다.
- 보유한 아이템 에셋들과 `cv.matchTemplate`를 수행하여 아이템 ID와 회전(Rotation) 각도를 식별합니다. (매칭률 85% 미만은 `isCustom: true` 처리)
- 인식된 칸들의 상대 좌표(Row, Col)를 계산하여 2차원 배열(`GridCell[][]`) 상태로 재구성한 뒤 메인 스레드로 반환합니다.

# Task 3: Smart UI Flow & Fallback (`components/SmartUploader.tsx`)
- 전체 화면에 `onPaste` (Ctrl+V) 이벤트를 걸어두고, 기존의 수동 크롭 UI(`react-image-crop`)는 기본적으로 숨깁니다.
- 유저가 이미지를 붙여넣으면 "인벤토리 자동 탐지 중..." 스피너를 띄웁니다.
- **[성공 시 UX]**: Worker에서 분석이 성공하면, 원본 스크린샷 위에 "OpenCV가 찾아낸 인벤토리 칸"들을 초록색 네모 테두리로 1초간 촤르륵 하이라이트하여 시각적 쾌감을 준 뒤, 즉시 **[자동 배치 최적화]** 로직으로 논스톱 전환시킵니다.
- **[핵심 - 실패 시 Fallback]**: 스크린샷 배경이 너무 복잡하거나 인벤토리가 안 열려있어 탐지(군집화)에 실패했다면, 에러 창을 띄우지 마세요. 조용히 **"자동 인식에 실패했습니다. 인벤토리 영역을 직접 지정해주세요."**라는 안내와 함께 숨겨뒀던 '수동 드래그 크롭 UI'를 띄워주는 완벽한 예외 처리(Fallback)를 구현하세요.

# Action Plan
- Worker와 메인 스레드 간의 이미지 데이터 전송 시 `Transferable Objects`를 사용하여 병목을 없애세요.
- AI인 당신은 먼저 전체 파이프라인의 데이터 흐름을 간략히 설명하고, `vision.worker.ts`의 핵심인 '격자 탐지 및 군집화' 알고리즘 뼈대부터 작성을 시작해 주세요.