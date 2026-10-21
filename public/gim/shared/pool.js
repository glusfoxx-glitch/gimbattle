/**
 * Pool d'objets à taille fixe avec free-list.
 * Tout est créé au chargement ; en jeu, on ne fait que recycler.
 * Les éléments actifs sont rangés de façon compacte dans `active` pour itérer sans trous.
 * Si le pool est plein, l'élément le plus ancien est recyclé (plutôt que d'allouer).
 */

/**
 * @typedef {Object} Poolable
 * @property {number} poolIndex
 * @property {number} activeIndex  -1 si libre.
 * @property {number} serial       Ordre d'acquisition (sert à retrouver le plus ancien).
 */

/** @template {Poolable} T */
export class Pool {
  /**
   * @param {number} capacity
   * @param {() => T} factory
   */
  constructor(capacity, factory) {
    this.capacity = capacity;
    /** @type {T[]} */
    this.items = new Array(capacity);
    /** @type {(T|null)[]} */
    this.active = new Array(capacity);
    this.free = new Int32Array(capacity);
    this.activeCount = 0;
    this.freeCount = capacity;
    this.serialCounter = 0;
    this.recycledCount = 0;
    for (let i = 0; i < capacity; i++) {
      const item = factory();
      item.poolIndex = i;
      item.activeIndex = -1;
      item.serial = 0;
      this.items[i] = item;
      this.active[i] = null;
      // Rempli à l'envers pour que le premier acquis soit l'index 0 (plus lisible en debug).
      this.free[i] = capacity - 1 - i;
    }
  }

  /** @returns {T} */
  acquire() {
    if (this.freeCount === 0) {
      this.release(this.findOldest());
      this.recycledCount++;
    }
    const item = this.items[this.free[--this.freeCount]];
    item.activeIndex = this.activeCount;
    this.active[this.activeCount++] = item;
    item.serial = ++this.serialCounter;
    return item;
  }

  /**
   * Retire un élément actif. Échange avec le dernier actif : O(1).
   * Pour libérer pendant une itération, parcourir `active` à l'envers.
   * @param {T} item
   */
  release(item) {
    const index = item.activeIndex;
    if (index < 0) return;
    const last = /** @type {T} */ (this.active[--this.activeCount]);
    this.active[index] = last;
    last.activeIndex = index;
    this.active[this.activeCount] = null;
    item.activeIndex = -1;
    this.free[this.freeCount++] = item.poolIndex;
  }

  /** @returns {T} */
  findOldest() {
    let oldest = /** @type {T} */ (this.active[0]);
    for (let i = 1; i < this.activeCount; i++) {
      const item = /** @type {T} */ (this.active[i]);
      if (item.serial < oldest.serial) oldest = item;
    }
    return oldest;
  }

  clear() {
    while (this.activeCount > 0) this.release(/** @type {T} */ (this.active[this.activeCount - 1]));
  }
}
