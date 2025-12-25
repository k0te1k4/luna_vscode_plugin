# LuNA Language Support (VS Code)

Расширение для Visual Studio Code для работы с языком **LuNA** (`.fa`) и файлом **ucodes.cpp**.

## Возможности

Работает **без ИИ** по умолчанию.

### Базовые возможности (не зависят от ИИ)

1. **Подсветка синтаксиса** для `.fa`.
2. **Автодополнение**:
   * ключевые слова LuNA (`sub`, `df`, `cf`, `request`, `delete`, ...)
   * сниппеты (фрагмент `cf`, заготовка `sub`, блок рекомендаций `@ { ... }`).
3. **LSP / Language Server** (включается автоматически):
   * работает для `.fa`
   * также подключён к `.cpp` (чтобы не ругаться на `ucodes.cpp` рядом).
4. **Подсказка создать `ucodes.cpp`**, если вы создали/изменили `.fa`, а `ucodes.cpp` рядом отсутствует.

### Опционально: LuNA AI Assistant (RAG по wiki)

Если включить опцию `luna.assistant.enabled`, расширение получает простого **AI-ассистента**, который:

* строит локальный индекс по **LuNA wiki** (Markdown-файлы в git submodule)
* отвечает на вопросы, опираясь на найденные фрагменты wiki (RAG)

Ассистент **не обязателен**: если он выключен, остальной функционал работает как обычно.

> Текущая реализация делает RAG локально:
> * эмбеддинги и генерация — через Yandex AI Studio API
> * сам индекс (векторы + тексты) хранится в workspace (`.luna/assistant/index.json`)

## Быстрый старт (без ассистента)

1. Установите расширение.
2. Откройте проект с файлами `.fa`.
3. Подсветка, автодополнение и LSP включатся автоматически.

## Подключение LuNA wiki через git submodule (для ассистента)

В корне вашего репозитория выполните:

```bash
git submodule add <URL_вашего_gitlab_репозитория_luna_wiki> luna.wiki
git submodule update --init --recursive
```

По умолчанию расширение ожидает wiki по пути `luna.wiki` (настраивается).

## Настройка Yandex AI Studio (для ассистента)

Ассистент использует **Yandex AI Studio API** и аутентификацию через заголовок:

```
Authorization: Api-Key <API_key>
```

Документация: API authentication в Yandex AI Studio.

### 1) Получите API key

Создайте service account и API key в Yandex Cloud (AI Studio рекомендует использовать API key для service account).

### 2) Укажите modelUri

Для эмбеддингов документации Yandex рекомендует пары моделей для поиска:

* `emb://<folder_ID>/text-search-doc/latest`
* `emb://<folder_ID>/text-search-query/latest`

Если вы заполните `luna.assistant.yandexFolderId`, расширение **автоматически подставит эти значения**, если поля modelUri пустые.

Для генерации ответа используется Text Generation API (`/foundationModels/v1/completion`).

`luna.assistant.generationModelUri` зависит от выбранной модели в AI Studio (примерный формат: `gpt://<folder_ID>/...`).

## Как включить ассистента

1. В **настройках VS Code** включите:
   * `LuNA › Assistant: Enabled` (`luna.assistant.enabled`)
2. Выполните команду:
   * **LuNA: Set Yandex API Key**
   (ключ сохранится в Secret Storage VS Code)
3. Выполните команду:
   * **LuNA: Reindex Wiki for Assistant**
4. Откройте чат:
   * **LuNA: Open AI Assistant**

## Команды

* `LuNA: Open AI Assistant` — открыть окно чата.
* `LuNA: Reindex Wiki for Assistant` — пересобрать индекс wiki.
* `LuNA: Toggle AI Assistant` — включить/выключить ассистента в настройках workspace.
* `LuNA: Set Yandex API Key` — сохранить API key в Secret Storage.

## Где хранится индекс

По умолчанию: `.luna/assistant/index.json` в корне workspace.

Файл содержит:

* `chunks[]`: текстовые фрагменты wiki
* `embedding[]`: вектор эмбеддинга

⚠️ Не добавляйте этот индекс в публичный репозиторий, если в wiki есть закрытая информация.

## Как работает RAG в расширении

1. **Индексация** (`Reindex Wiki`)
   * находит все `.md/.markdown` в папке wiki
   * режет по заголовкам `# ...` и по ~`chunkChars`
   * для каждого чанка вызывает Embeddings API (`/foundationModels/v1/textEmbedding`)
   * сохраняет в локальный JSON
2. **Вопрос**
   * строит эмбеддинг вопроса (query-модель)
   * находит Top‑K похожих чанков (cosine similarity)
   * отправляет в Text Generation API промпт: «ответь только на основе этих фрагментов»

## Сборка/разработка

```bash
npm install
npm run compile
```

## Лицензия

Укажите вашу лицензию (например, MIT) в `package.json` и добавьте `LICENSE`.
