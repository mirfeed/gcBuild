import type { ReactNode } from 'react';
import { getLang, t } from '../i18n';

interface Step {
  title: string;
  body: ReactNode;
}

const STEPS: Record<'en' | 'ru', { steps: Step[]; tips: ReactNode[] }> = {
  ru: {
    steps: [
      {
        title: 'Отряд',
        body: <>Нажмите «Добавить персонажа» в пустом слоте, выберите оружие и сет. Звёздочка ☆ — кто стоит на поле в начале.</>,
      },
      {
        title: 'Статы',
        body: (
          <>
            <b>KQMS</b> — стандартные статы KQM одной кнопкой, цель ВЭ задаёте сами. <b>Артефакты</b> — соберите персонажа из своих
            артефактов: сначала импортируйте файл GOOD («Артефакты» в шапке) или персонажей с Enka. <b>Вручную</b> — точные цифры.
          </>
        ),
      },
      {
        title: 'Ротация',
        body: (
          <>
            Нажимайте кнопки навыков (E, Q, N1…) — действия встают туда, где мигает курсор. Или впишите ротацию текстом, например{' '}
            <code>Bennett Q E Xiangling Q E Raiden E Q 3N3CA</code>, и нажмите Enter. «Открытие» выполняется один раз, «Цикл» повторяется
            до конца сима. Подсказка у персонажа: зелёный — навык готов, жёлтый — ещё на КД.
          </>
        ),
      },
      {
        title: 'Настройки сима',
        body: <>Выберите пресет цели («gcsim / KQMS по умолчанию» или манекен Miliastra: A12 / SoF / SoD) и длительность.</>,
      },
      {
        title: 'Запуск',
        body: (
          <>
            Один раз нажмите «Скачать gcsim», затем «Запустить сим» (Ctrl+Enter): появятся ДПС, вклад каждого и реакции.
            «Проверить ВЭ» покажет, хватает ли энергии на каждый взрыв, и предложит исправить.
          </>
        ),
      },
      {
        title: 'Таймлайн',
        body: (
          <>
            «Прикидка» обновляется на ходу, пока собираете ротацию. «Сэмпл gcsim» появляется после сима: настоящие удары, реакции,
            энергия и баффы. Тяните мышью, Ctrl+колёсико — масштаб, «Вписать» — показать целиком.
          </>
        ),
      },
      {
        title: 'Сохранение',
        body: <>💾 на карточке — билд в «Мои билды». «Отряды» — сохранить весь отряд. Всё хранится на этом компьютере.</>,
      },
    ],
    tips: [
      <>Запись ротации: <code>N2</code> — две обычные атаки, <code>C</code> — заряженная, <code>hE</code> — E с удержанием, <code>10N2CD</code> — повторить 10 раз, <code>Q?</code> — только если взрыв готов.</>,
      <>Условие: кликните по действию в ротации → «Выполнять, только если…» (например, ХП &lt; 50%).</>,
      <>Переключатель «Расширенный» в шапке показывает все настройки: роллы сабстатов, логические блоки, оптимизатор, сырой конфиг.</>,
      <>Что-то не так — меню ⋯ → «Сообщить об ошибке».</>,
    ],
  },
  en: {
    steps: [
      {
        title: 'Team',
        body: <>Click “Add character” in an empty slot, then pick a weapon and a set. The ☆ star marks who starts on the field.</>,
      },
      {
        title: 'Stats',
        body: (
          <>
            <b>KQMS</b>: standard KQM substats in one click, you set the ER target. <b>Artifacts</b>: build the character from your own
            artifacts; import a GOOD file first (Artifacts in the header) or characters from Enka. <b>Custom stats</b>: exact numbers.
          </>
        ),
      },
      {
        title: 'Rotation',
        body: (
          <>
            Click the skill buttons (E, Q, N1…): actions go where the cursor blinks. Or type it as text, e.g.{' '}
            <code>Bennett Q E Xiangling Q E Raiden E Q 3N3CA</code>, and press Enter. The opener runs once, the loop repeats until the
            sim ends. Next to each character: green = skill ready, yellow = still on cooldown.
          </>
        ),
      },
      {
        title: 'Sim settings',
        body: <>Pick a target preset (“gcsim / KQMS default” or the Miliastra dummy: A12 / SoF / SoD) and the duration.</>,
      },
      {
        title: 'Run',
        body: (
          <>
            Click “Download gcsim” once, then “Run sim” (Ctrl+Enter) for DPS, each character&apos;s share and reactions. “Check ER”
            shows whether every burst has enough energy and offers a fix.
          </>
        ),
      },
      {
        title: 'Timeline',
        body: (
          <>
            “Estimate” updates while you build. “gcsim sample” appears after a sim: real hits, reactions, energy and buffs. Drag to
            pan, Ctrl+wheel to zoom, “Fit” to see everything.
          </>
        ),
      },
      {
        title: 'Saving',
        body: <>💾 on a card saves the build to My builds. “Teams” saves the whole team. Everything stays on this computer.</>,
      },
    ],
    tips: [
      <>Rotation text: <code>N2</code> two normal attacks, <code>C</code> charged attack, <code>hE</code> hold E, <code>10N2CD</code> repeat 10 times, <code>Q?</code> only if the burst is ready.</>,
      <>Conditions: click an action in the rotation → “Only run if…” (e.g. HP &lt; 50%).</>,
      <>The Advanced switch in the header shows every setting: substat rolls, logic blocks, the optimizer, the raw config.</>,
      <>Something wrong? ⋯ menu → “Report a bug”.</>,
    ],
  },
};

const SEEN_KEY = 'gcbuild.help.seen';

/** Whether the guide was already shown once (it opens by itself on the first visit). */
export function helpSeen(): boolean {
  try {
    return !!localStorage.getItem(SEEN_KEY);
  } catch {
    return true;
  }
}

export function markHelpSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // storage unavailable
  }
}

/** Short step-by-step guide in the current language. */
export function HelpPanel({ onClose }: { onClose: () => void }) {
  const { steps, tips } = STEPS[getLang()];
  return (
    <section className="panel help">
      <div className="panel-head">
        <h2>{t('How to use')}</h2>
        <span className="grow" />
        <button type="button" className="icon-btn" onClick={onClose} title={t('Close')}>✕</button>
      </div>
      <ol className="help-steps">
        {steps.map((s, i) => (
          <li key={i}>
            <span className="help-num">{i + 1}</span>
            <div>
              <b>{s.title}</b>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="help-tips">
        <b>{t('Tips')}</b>
        <ul>{tips.map((tip, i) => <li key={i}>{tip}</li>)}</ul>
      </div>
    </section>
  );
}
