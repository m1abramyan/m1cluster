# Проверенные контракты MGU Store и cluster-render

Исследовано локально 14 ноября 2026 года. Это анализ открытых исходников, не подтверждение версий или поведения на BMW пользователя. Автомобиль не опрашивался; SSH, установка, перезапуск, прошивка и кодирование не выполнялись.

## Зафиксированные первичные источники

| Локальная копия | Источник | Commit SHA |
|---|---|---|
| `upstream/bimmer-apps` | [bimmer-lab/apps](https://github.com/bimmer-lab/apps/tree/aaa43e49500ccb4cd6b07537644ac072db49eb99) | `aaa43e49500ccb4cd6b07537644ac072db49eb99` |
| `upstream/mgu-store` | [robertnisipeanu/mgu-store](https://github.com/robertnisipeanu/mgu-store/tree/9c2360a211cfe75fbe4c2b2db86f84a33b380fb9) | `9c2360a211cfe75fbe4c2b2db86f84a33b380fb9` |
| `upstream/robert-idrive-apps` | [robertnisipeanu/idrive-apps](https://github.com/robertnisipeanu/idrive-apps/tree/f7a678b27693c88a12d2ed4f18ac4652f005bffd) | `f7a678b27693c88a12d2ed4f18ac4652f005bffd` |
| `upstream/idrive7-apps` | [cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps/tree/9f0f68afe8407e80c411d9be92519528c3f6f023) | `9f0f68afe8407e80c411d9be92519528c3f6f023` |

Копии оригиналов оставлены отдельно для сравнения. Их собственные файлы лицензий сохранены. Рабочий проект не должен отправлять `upstream/`, SDK или локальные данные в публикуемый исходный архив целиком.

## Упаковка и SDK

Первичный контракт: [MGU Store PUBLISHING.md](https://github.com/robertnisipeanu/mgu-store/blob/9c2360a211cfe75fbe4c2b2db86f84a33b380fb9/docs/PUBLISHING.md), разделы Rules, Repo tree, Build scripts; [updater README](https://github.com/robertnisipeanu/mgu-store/blob/9c2360a211cfe75fbe4c2b2db86f84a33b380fb9/native/mgu-updater/README.md), строки 158–240 и 447–472.

- Store поддерживает исходный repo-tree с `mgu-repo.json`, каталоги и готовые OAP `.tgz`/`.mgu`. Для этого проекта нужен ровно один компонент `manuk_retro_cluster` с `mguHmi: ["ID7"]`.
- Поля `build.python`, `args`, `sdk`, `output` документированы; подстановки `{id}`, `{version}`, `{dir}` поддерживаются. В исходнике путь приложения должен соответствовать id. Сборка запускается из корня записываемой копии исходников.
- Python в Store build flow — 3.12, Node — 8.16.2; непривилегированный build uid, без сети по умолчанию, предел 10 минут и 200 MB. Не добавлять network-флаг: проект не должен ничего скачивать при сборке в автомобиле.
- `build.sdk: "oap-sdk"` поручает Store сгенерировать модуль из штатного BMW donor app и положить его в эту папку перед сборкой. `MGU_SDK_DONOR` также указывает донор. Проприетарный SDK не распространяется вместе с исходниками.
- В оригинальном `bimmer-apps/kit/tools/build.py:509–510` SDK копируется без проверки в выходной пакет. Поэтому проектная обёртка обязана отказаться от автомобильной сборки при отсутствии реального SDK и при обнаружении `BENCH_STUB`.
- `engines.node >=8.7.0` в upstream package generation — декларация, не тест. Целевую совместимость нужно отдельно проверять Node 8.16.2, включая используемые стандартные API.
- Итоговый пакет должен сохранить RHMI entry point, `manifest.json`, permissions, имя/версию и ID7 ресурсы. Наличие технической страницы не обязывает открывать её программно.

## Автозапуск: что реально читает установщик

Первичный код: [mgu-deploy.js](https://github.com/robertnisipeanu/mgu-store/blob/9c2360a211cfe75fbe4c2b2db86f84a33b380fb9/deploy/unit/mgu-deploy.js), строки 2697–2699, 4105–4111, 4241–4243, 4729–4732. Объяснение — [deploy README](https://github.com/robertnisipeanu/mgu-store/blob/9c2360a211cfe75fbe4c2b2db86f84a33b380fb9/deploy/README.md), строки 1395–1402. Исследованная версия deploy tool — **0.8.18**; минимальная версия появления этого поля не установлена.

1. Установщик читает **итоговый `package.json.mguAppStartType`**, а не произвольный `app.json` проекта.
2. Допустимы только `manually`, `lum`, `autostart`; другое значение отклоняет артефакт. При отсутствии поля применяется `manually`.
3. `listApp()` передаёт значение в `custom_apps.json`, `-appStartType`. Тип применяется при install/update менеджером приложений.
4. `autostart` означает запуск вместе с платформой, повторный запуск менеджером после остановки и отсутствие остановки за фоновую неактивность. **Не следует использовать exit как выключатель отрисовки**: это способно породить повторные старты. При disable приложение должно спокойно оставаться без своих слоёв.
5. У оригинального bimmer builder в строках 418–429 `mguAppStartType` вообще не копируется. Одно поле в app.json ничего не доказывает. В производном builder необходимы явная запись и проверка `package.json` внутри архива.
6. В другом первичном kit, `idrive7-apps/kit/tools/build.py:625–628`, `app.json.autostart` переводится в `package.json.mguAppStartType = autostart`; runtime `kit/runtime/mgu.js:619` имеет `impl.background()` независимо от RHMI. Это подтверждает существование такого жизненного цикла, но не заменяет адаптацию bimmer fork.
7. В исследованном Store UI не найден отдельный пользовательский переключатель start type. Подтверждённый способ изменить его — новая явно подготовленная версия пакета и обычное update. Та же версия может считаться уже установленной. До ручного теста поставляется `manually`.
8. Сохранённый runtime-конфиг `enabled` и упаковочный start type решают разные задачи: первый разрешает слои, второй — запуск процесса. Изменение JSON-конфига приложения не должно самостоятельно редактировать Store или BMW provisioning.

Upstream tests `deploy/test/run.js:673–681` проверяют manual default → autostart update → manual update. В этом исследовании эти upstream tests прочитаны; их полный набор не запускался и не является тестом автомобиля.

## Отдельные состояния готовности

- **Процесс** создан MainApp; `OnlineApp.start()` и `registerActive()` — OAP жизненный цикл. Не требуется показывать страницу ради вызова фоновой логики.
- **Сигналы**: готовность SOME/IP proxy и валидность значений независимы от renderer. В upstream `signals.watch()` использует `subscribeToAvailability`, `getValue`, события `subscribe`; некоторые поля событийные и не повторяются при неизменном значении.
- **Renderer transport**: Unix socket соединился и `hello` принят.
- **Цель дисплея**: отдельные `target`/`layer` события сообщают `shown`, `waiting`, `unavailable`, `suspended` и т. п. Успешный socket connect не означает, что KOMBI показывает сцену.
- **Техническая страница**: отдельное пользовательское действие. Закрытие страницы не должно запускать/останавливать renderer и не должно быть единственным источником таймеров приложения.

Не держать автомобиль бодрствующим: не добавлять root-сервис, системные keep-alive или принудительный restart. Приложение должно исполнять запрос `shutdown` и сбрасывать отображение при потере жизненного цикла источника; отключённая отрисовка не возобновляется автоматически из-за отсутствия сигналов.

## Renderer protocol и освобождение слоёв

Первичный источник: [PROTOCOL.md, version 1](https://github.com/robertnisipeanu/idrive-apps/blob/f7a678b27693c88a12d2ed4f18ac4652f005bffd/native/cluster-render/PROTOCOL.md); клиент — [cluster_render_client.js](https://github.com/robertnisipeanu/idrive-apps/blob/f7a678b27693c88a12d2ed4f18ac4652f005bffd/native/cluster-render/js/cluster_render_client.js). Исследованная версия сервиса — **0.5.9** (`component.json`). Устанавливать или запускать второй renderer не нужно.

- Socket: `/dev/shm/cluster-render/render.sock`, группа `tm_oap_app`; не адрес автомобиля.
- Framing: LE `u32 length`, затем `u8 type` и body; JSON type `J`, pixels `F`, mesh `M`.
- `hello`: `app` — собственное имя клиента, `proto: 1`. Наш id не должен быть `cluster_themes`.
- Референсы слоёв/ресурсов — положительные числа, уникальные **внутри соединения**; могут начинаться с 1 без конфликта с другим приложением.
- Цель iDrive 7 `panel` — 1920×720, slot 0x203. ID RAMSES scene выбирает общий renderer. Проект не должен заводить отдельный произвольный scene id или менять renderer config.
- `drop` с `ref` удаляет свой слой/сцену/неиспользуемый asset. Сначала слои, затем ресурсы, которые они использовали. Все ресурсы соединения также уходят при disconnect.
- Node-клиент автоматически переподключается и повторяет собственные ресурсы/слои. При disable требуется удалить их и закрыть собственные соединения; оставить старые слои в клиентском replay-кэше значит получить их снова после reconnect.
- `ClusterRender.close()` останавливает reconnect timer и уничтожает socket. `drop()` удаляет локальный слой; asset, который ещё sampled, не удаляется. `close()` сам не очищает Map клиентских ресурсов — новый enable должен пересоздать корректный набор.
- Цель освобождается только когда больше нет желающих видимых слоёв всех клиентов, после linger/fade. В исследованной конфигурации `panel_linger_ms = 3000`. Если другая тема продолжает рисовать, наш disable не отключает её.
- `target.rendering = verified` означает наблюдаемую renderer subscription, а не проверку читаемости глазами водителя. `unobservable` также предусмотрено протоколом.
- Полное возвращение штатной приборки после падения процесса/сервиса требует проверки на конкретном автомобиле. Стенд подтверждает лишь то, что наш клиент отправил drop/закрыл соединение и его слои исчезли в эмуляторе.

### Лимиты и расхождение версий

В актуальном исследованном протоколе: 64 слоя на клиента / 96 на сервис, 16 assets на клиента / 32 на сервис, 16 MB общего pixel memory, image/uncompressed asset обычно учитывается дважды, одно сообщение максимум 5 529 664 байта. Шейдеры — GLSL ES 1.00.

**Документация pinned bimmer fork говорит об историческом лимите 8 слоёв на соединение / 32 на сервис** (`docs/DEVELOPING.md:47`). Нельзя приписывать новой документации установленный у пользователя сервис. Для первого теста нужен измеренный отчёт числа слоёв и памяти нашего Retro и проверка установленной версии/доступных лимитов. Другие приложения делят тот же бюджет.

Координаты маски видимости в bimmer `shared/visible.js` основаны на фотографиях другого автомобиля. Это полезный диагностический overlay стенда, **не подтверждённая маска BMW G30 540i пользователя**.

## Сигналы: что нельзя переносить без изменения

Проверено по `idrive7-apps/kit/runtime/car.js` и `bimmer-apps/kit/runtime/car.js`:

- Скорость: `Vehicle2.statusCarSpeed2.speedVehicleCentreOfGravity`, множитель 0.015625; обороты: `CDS.statusEngineSpeed2.actualValueRPMEngineCrankshaft`, множитель 0.25.
- Температуры: `CDS.statusEngineTemperature.temperatureEngineDrive / temperatureEngineOilDrive`, offset −48; invalid 255. Для speed/rpm invalid 65535.
- Передача: `VehicleInformation.statusGearboxDrive` и альтернативный `DataPowerTrain2.statusGearSelectionDrive`; P/N должны различаться только при наличии selector state. Неподтверждённый `N_OR_P` нельзя показывать как P или N.
- В оригинальном Car есть **Demo fallback и GearGuess**. Они не подходят автомобильному профилю этой задачи. Даже `demo: off` само по себе не отменяет угадывание передачи в оригинальном коде.
- В оригинальном HUD есть диагностический опрос boost/intake через DME, а также предположения об атмосферном давлении/размере бака/пиковых характеристиках двигателя. Для первой версии не копировать эти предположения в реальные данные. Нет подтверждённого значения — поле недоступно.
- В `signals.js` есть и read, и write helper. Доступность функции не разрешает её использование; приложение должно ограничиться подписками и чтением нужных полей, без `setValue`, UDS write, сброса ошибок и управления блоками.

## Установка без публикации и сохранение данных

- Store сканирует распакованный USB repo-tree: корень носителя, `mgu-repo/`, `mgu-repo/<name>/`, если там находится `mgu-repo.json`. **ZIP сначала распаковывается на Mac**: прямое чтение source ZIP в этом flow не задокументировано.
- `mgu-repo.json` должен перечислять только наше приложение. В USB-папке нужны наш app, производные shared/kit, build scripts, конфигурация, лицензии; не все upstream checkout, SDK или стендовые заглушки.
- Store → USB → наш источник → Retro Cluster → Install. Сначала он покажет/проверит зависимости. Наличие `requires` может предложить установить/обновить инструменты; в первом тесте зависимости сверяются заранее, неподготовленные обновления не подтверждаются.
- Обычный update сохраняет uid, `data/` и keychain (`deploy/README.md:1358–1362`); код в `source/` заменяется. Поэтому пользовательский JSON должен лежать в отдельном `oap_<UID>/data/`, а не в `source/config/`.
- Uninstall приложения намеренно удаляет его data. Перед удалением нужный JSON сохраняют отдельно. Не обещать сохранность при аварии MainApp: upstream kit отдельно предупреждает, что CorruptAppsHandler способен удалить данные после повторных аварий.
- В Store confirmation есть **Remove** (только выбранное приложение) и иногда **Remove all** (также инструменты `requiredAlone`): `apps/robertn_store/src/store_ui.js:445–453`. Для этой задачи только **Remove** для `manuk_retro_cluster`.
- Документированная целевая команда установщика на самом HU: `/var/opt/mgu-deploy/mgu-deploy.sh uninstall manuk_retro_cluster --yes`. Это реальная upstream команда, но она не выполнялась. Через Store её не нужно запускать вручную.
- `mgu-install.js uninstall` удаляет установку Store целиком и **не подходит** для отката нашего приложения. `remove-all`, `restore`, `first-install`, flash/root/fix-key также не входят в процедуру.
- На старых версиях Store install/uninstall может требовать bounce MainApp или перезапуск HU; это отражено в upstream документации. Нельзя гарантировать бесшовную установку на неизвестной версии. Если штатный интерфейс требует отдельного restart, остановить этот тест и согласовать следующий шаг, не перезапускать автоматически.

## Лицензии

`bimmer-lab/apps` — MIT; `cauliflowermossgrape/idrive7-apps` — MIT с указанными в оригинале авторами. `robertnisipeanu/idrive-apps` в целом GPL-3.0-or-later, но `native/cluster-render/js/cluster_render_client.js`, PROTOCOL, client/include/kit явно MPL-2.0 (README:75–81, SPDX headers). Копия MPL сохранена в `licenses/MPL-2.0.txt`; сохранять Robert Nisipeanu copyright и SPDX в производных файлах. Исследование Store не требует включать GPL implementation Store в наше приложение.

## Что осталось подтвердить на автомобиле

Точные версии MainApp/OAP SDK/Node/Store/updater/deploy/renderer; наличие signals и их invalid/enum значения на конкретной прошивке; readiness transitions и событийность; часы; fuel scaling и реальный бак; boost источник; фактическая видимость 1920×720 и штатных предупреждений; освобождение слоёв и возврат BMW картинки; поведение manual app в фоне; сохранение конфигурации при настоящем update; сон/пробуждение. Никакой вывод выше не является разрешением дорожного теста.
